import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, MapPin, Trophy, Navigation, RefreshCw, X, Scan } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const PATH_LENGTH = 10; // 10 meters path
const DOT_SPACING = 1.0;
const GAME_TIME_LIMIT = 60; // 60 seconds
const GAME_STATES = {
  START: 'START',
  SCANNING: 'SCANNING',
  PLACED: 'PLACED',
  SUCCESS: 'SUCCESS',
};

export default function ARGame() {
  const [gameState, setGameState] = useState(GAME_STATES.START);
  const gameStateRef = useRef(gameState);
  const [distance, setDistance] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(GAME_TIME_LIMIT);
  const timeLeftRef = useRef(timeLeft);
  const [qualityGrade, setQualityGrade] = useState<string>('');
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [isHitTestReady, setIsHitTestReady] = useState(false);

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    reticle: THREE.Mesh;
    tomatoSprite: THREE.Sprite;
    hudTexture: THREE.CanvasTexture;
    hudContext: CanvasRenderingContext2D;
    hudSprite: THREE.Sprite;
    successTexture: THREE.CanvasTexture;
    successContext: CanvasRenderingContext2D;
    successSprite: THREE.Sprite;
    pathGroup: THREE.Group;
    hitTestSource: XRHitTestSource | null;
    hitTestSourceRequested: boolean;
  } | null>(null);

  // --- Timer Logic ---
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === GAME_STATES.PLACED) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 0) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState]);

  // --- WebXR Support Check ---
  useEffect(() => {
    if ('xr' in navigator) {
      (navigator as any).xr.isSessionSupported('immersive-ar').then((supported: boolean) => {
        setArSupported(supported);
      });
    } else {
      setArSupported(false);
    }
  }, []);

  // --- Three.js Setup ---
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    scene.add(camera);
    
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;

    // --- Texture Loader ---
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');
    const tomatoTexture = textureLoader.load('https://impact-1394762829.cos.ap-guangzhou.myqcloud.com/tomato.png');
    const logoTexture = textureLoader.load('https://impact-1394762829.cos.ap-guangzhou.myqcloud.com/logo.png');

    // --- 3D HUD Setup (Shrinked) ---
    const hudCanvas = document.createElement('canvas');
    hudCanvas.width = 1024;
    hudCanvas.height = 256;
    const hudContext = hudCanvas.getContext('2d')!;
    const hudTexture = new THREE.CanvasTexture(hudCanvas);
    const hudMat = new THREE.SpriteMaterial({ map: hudTexture, transparent: true, opacity: 0.9 });
    const hudSprite = new THREE.Sprite(hudMat);
    
    // Position HUD at bottom center - Very Small
    hudSprite.scale.set(0.25, 0.06, 1);
    hudSprite.position.set(0, -0.25, -0.5); 
    camera.add(hudSprite);

    // --- 3D Success Board Setup ---
    const successCanvas = document.createElement('canvas');
    successCanvas.width = 1024;
    successCanvas.height = 1024;
    const successContext = successCanvas.getContext('2d')!;
    const successTexture = new THREE.CanvasTexture(successCanvas);
    const successMat = new THREE.SpriteMaterial({ map: successTexture, transparent: true });
    const successSprite = new THREE.Sprite(successMat);
    
    // Position in center of view
    successSprite.position.set(0, 0, -1);
    successSprite.scale.set(0.6, 0.6, 1);
    successSprite.visible = false;
    camera.add(successSprite);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(2, 5, 2);
    scene.add(directionalLight);

    // Reticle (Scanning UI)
    const reticleGeo = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Path Group (Hidden initially)
    const pathGroup = new THREE.Group();
    pathGroup.visible = false;
    scene.add(pathGroup);

    // Create Path Dots
    for (let i = 0; i < PATH_LENGTH; i++) {
      const dotGeo = new THREE.SphereGeometry(0.04, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 1 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(0, 0.02, -i * DOT_SPACING);
      pathGroup.add(dot);

      if (i % 2 === 0 && i < PATH_LENGTH - 1) {
        const arrowGeo = new THREE.ConeGeometry(0.08, 0.2, 16);
        const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(0, 0.05, -i * DOT_SPACING - 0.5);
        pathGroup.add(arrow);
      }
    }

    // Start Logo Plane
    const logoGeo = new THREE.PlaneGeometry(0.6, 0.6);
    const logoMat = new THREE.MeshBasicMaterial({ 
      map: logoTexture, 
      transparent: true, 
      alphaTest: 0.05 
    });
    const logoMesh = new THREE.Mesh(logoGeo, logoMat);
    logoMesh.rotation.x = -Math.PI / 2;
    logoMesh.position.set(0, 0.01, 0);
    pathGroup.add(logoMesh);

    // 3D Tomato (Sprite)
    const tomatoMat = new THREE.SpriteMaterial({ map: tomatoTexture });
    const tomatoSprite = new THREE.Sprite(tomatoMat);
    tomatoSprite.scale.set(0.5, 0.5, 1);
    tomatoSprite.position.set(0, 0.4, -PATH_LENGTH * DOT_SPACING);
    pathGroup.add(tomatoSprite);

    // Final Box
    const boxGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 0.025, -PATH_LENGTH * DOT_SPACING);
    pathGroup.add(box);

    sceneRef.current = { 
      scene, camera, renderer, reticle, tomatoSprite, pathGroup, 
      hudTexture, hudContext, hudSprite,
      successTexture, successContext, successSprite,
      hitTestSource: null, hitTestSourceRequested: false,
    } as any;

    // WebXR Button
    const arButton = ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: containerRef.current }
    });
    document.body.appendChild(arButton);

    // Auto-transition to SCANNING when session starts
    renderer.xr.addEventListener('sessionstart', () => {
      setGameState(GAME_STATES.SCANNING);
    });

    // Controller for interaction
    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    function onSelect() {
      if (sceneRef.current && sceneRef.current.reticle.visible && gameStateRef.current === GAME_STATES.SCANNING) {
        const { reticle, pathGroup } = sceneRef.current;
        pathGroup.position.setFromMatrixPosition(reticle.matrix);
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        const lookPos = new THREE.Vector3(camPos.x, pathGroup.position.y, camPos.z);
        pathGroup.lookAt(lookPos);
        pathGroup.rotateY(Math.PI);
        pathGroup.visible = true;
        reticle.visible = false;
        setGameState(GAME_STATES.PLACED);
      }
    }

    // Animation Loop
    renderer.setAnimationLoop((timestamp, frame) => {
      if (!sceneRef.current) return;
      const { renderer, scene, camera, reticle, pathGroup, tomatoSprite, hudTexture, hudContext, hudSprite, successTexture, successContext, successSprite } = sceneRef.current;

      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (session && !sceneRef.current.hitTestSourceRequested) {
          session.requestReferenceSpace('viewer').then((viewerSpace) => {
            session.requestHitTestSource!({ space: viewerSpace }).then((source) => {
              sceneRef.current!.hitTestSource = source;
            });
          });
          sceneRef.current.hitTestSourceRequested = true;
          setIsHitTestReady(true);
        }

        if (sceneRef.current.hitTestSource) {
          const hitTestResults = frame.getHitTestResults(sceneRef.current.hitTestSource);
          if (hitTestResults.length > 0 && gameStateRef.current === GAME_STATES.SCANNING) {
            const hit = hitTestResults[0];
            reticle.visible = true;
            reticle.matrix.fromArray(hit.getPose(referenceSpace!)!.transform.matrix);
          } else {
            reticle.visible = false;
          }
        }

        // Real-time distance calculation & HUD update
        if (gameStateRef.current === GAME_STATES.PLACED) {
          const camPos = new THREE.Vector3();
          camera.getWorldPosition(camPos);
          const tomatoPos = new THREE.Vector3();
          tomatoSprite.getWorldPosition(tomatoPos);
          const dist = camPos.distanceTo(tomatoPos);
          setDistance(dist);

          // Update 3D HUD - High Resolution Text
          hudContext.clearRect(0, 0, 1024, 256);
          hudContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
          hudContext.roundRect(20, 20, 984, 216, 60);
          hudContext.fill();
          
          hudContext.font = 'bold 80px sans-serif';
          hudContext.fillStyle = '#ff4444';
          hudContext.textAlign = 'center';
          hudContext.fillText(`Distance: ${dist.toFixed(1)}m`, 512, 110);
          
          hudContext.font = 'bold 60px sans-serif';
          hudContext.fillStyle = 'white';
          hudContext.fillText(`Time: 00:${timeLeftRef.current.toString().padStart(2, '0')}s`, 512, 200);
          
          hudTexture.needsUpdate = true;

          // Dynamic Scaling
          const scaleFactor = 0.5 * (timeLeftRef.current / GAME_TIME_LIMIT);
          tomatoSprite.scale.set(scaleFactor, scaleFactor, 1);

          // Success trigger (Updated threshold to 1.5m)
          if (dist < 1.5) {
            const finalTime = timeLeftRef.current;
            let grade = 'Bad';
            if (finalTime > 40) grade = 'Perfect';
            else if (finalTime > 20) grade = 'Good';
            
            // 3D SUCCESS BOARD LOGIC - Async Image Loading to prevent transparency bug
            pathGroup.visible = false;
            hudSprite.visible = false;

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = 'https://impact-1394762829.cos.ap-guangzhou.myqcloud.com/tomato.png';
            
            img.onload = () => {
              // 1. 清空并画背景
              successContext.clearRect(0, 0, 1024, 1024);
              successContext.fillStyle = 'rgba(0, 0, 0, 0.85)';
              successContext.roundRect(50, 50, 924, 924, 100);
              successContext.fill();
              successContext.strokeStyle = 'white';
              successContext.lineWidth = 10;
              successContext.stroke();

              // 2. 画顶部标题 (Y: 200)
              successContext.font = 'black italic 120px sans-serif';
              successContext.fillStyle = '#facc15';
              successContext.textAlign = 'center';
              successContext.fillText('VICTORY!', 512, 200);

              // 3. 画底部信息文字 (Y: 680 开始往下排)
              successContext.font = 'bold 50px sans-serif';
              successContext.fillStyle = 'white';
              successContext.fillText('Ingredient Found: TOMATO', 512, 680);
              
              successContext.font = 'bold 80px sans-serif';
              successContext.fillStyle = grade === 'Perfect' ? '#4ade80' : grade === 'Good' ? '#facc15' : '#f87171';
              successContext.fillText(`Quality: ${grade}`, 512, 780);

              successContext.font = 'bold 40px sans-serif';
              successContext.fillStyle = 'rgba(255,255,255,0.4)';
              successContext.fillText('Refresh page to play again', 512, 880);

              // 4. 画中间的图片 (Y: 280 开始，高度 300)
              // 保证居中: x = 512 - 150 = 362
              successContext.drawImage(img, 362, 280, 300, 300);

              // 5. 通知更新并显示
              successTexture.needsUpdate = true;
              successSprite.visible = true;

              setQualityGrade(grade);
              setGameState(GAME_STATES.SUCCESS);
            };

            img.onerror = () => {
              console.error("Failed to load success image");
              // Fallback: Draw without image
              successContext.clearRect(0, 0, 1024, 1024);
              successContext.fillStyle = 'rgba(0, 0, 0, 0.85)';
              successContext.roundRect(50, 50, 924, 924, 100);
              successContext.fill();
              successContext.font = 'bold 80px sans-serif';
              successContext.fillStyle = 'white';
              successContext.textAlign = 'center';
              successContext.fillText('VICTORY!', 512, 512);
              successTexture.needsUpdate = true;
              successSprite.visible = true;
              
              setQualityGrade(grade);
              setGameState(GAME_STATES.SUCCESS);
            };
          }
        }
      }

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      if (arButton.parentNode) arButton.parentNode.removeChild(arButton);
      renderer.dispose();
    };
  }, []);

  const startScanning = () => {
    setGameState(GAME_STATES.SCANNING);
  };

  return (
    <div ref={containerRef} className={cn(
      "fixed inset-0 w-full h-screen overflow-hidden pointer-events-none select-none",
      gameState === GAME_STATES.SUCCESS ? "bg-black" : "bg-transparent"
    )}>
      {/* Three.js Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* UI Overlay */}
      <div className="absolute inset-0 flex flex-col z-10">
        {/* Header */}
        <div className="p-6 flex justify-between items-start pointer-events-auto">
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">WebXR Quest</p>
              <p className="text-sm font-semibold">Find the Magic Ingredients</p>
            </div>
          </div>
        </div>

        {/* Center Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <AnimatePresence mode="wait">
            {gameState === GAME_STATES.START && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="bg-black/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/20 max-w-xs pointer-events-auto"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-red-400 to-red-600 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-2xl shadow-red-500/40 rotate-12">
                  <Scan className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Real AR Mode</h2>
                <p className="text-white/70 text-sm mb-8 leading-relaxed">
                  Experience true spatial navigation. Please use a WebXR compatible mobile browser (Chrome on Android).
                </p>
                <button
                  onClick={startScanning}
                  className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-red-500 hover:text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Navigation className="w-5 h-5" />
                  Enter AR World
                </button>
              </motion.div>
            )}

            {gameState === GAME_STATES.SCANNING && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-black/40 backdrop-blur-md p-6 rounded-3xl border border-white/10 max-w-xs"
              >
                <div className="flex items-center justify-center gap-3 mb-2">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-3 h-3 bg-white rounded-full"
                  />
                  <p className="text-sm font-bold uppercase tracking-widest">Scanning Ground</p>
                </div>
                <p className="text-xs text-white/60">Point your camera at a flat surface and tap to place the path.</p>
              </motion.div>
            )}

            {gameState === GAME_STATES.PLACED && distance !== null && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-32 w-full px-6 pointer-events-auto"
              >
                <div className="bg-black/60 backdrop-blur-xl p-6 rounded-[2rem] border border-white/20 shadow-2xl">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Real Distance</p>
                      <p className="text-3xl font-black italic tracking-tighter text-red-500">
                        {distance.toFixed(1)}<span className="text-sm not-italic ml-1">m</span>
                      </p>
                    </div>
                    <div className="text-right border-l border-white/10 pl-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Time Left</p>
                      <p className={cn(
                        "text-3xl font-black italic tracking-tighter",
                        timeLeft < 10 ? "text-red-500 animate-pulse" : "text-white"
                      )}>
                        00:{timeLeft.toString().padStart(2, '0')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-gradient-to-r from-red-600 to-red-400"
                      initial={{ width: "100%" }}
                      animate={{ width: `${(timeLeft / GAME_TIME_LIMIT) * 100}%` }}
                    />
                  </div>
                  
                  <p className="mt-4 text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] text-center">
                    Hurry! The tomato is shrinking...
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Success Modal */}
        <AnimatePresence>
          {gameState === GAME_STATES.SUCCESS && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md pointer-events-auto"
            >
              <motion.div
                initial={{ scale: 0.5, y: 100, rotate: -10 }}
                animate={{ scale: 1, y: 0, rotate: 0 }}
                transition={{ type: 'spring', damping: 12 }}
                className="bg-white text-black p-10 rounded-[3rem] text-center relative overflow-hidden max-w-sm shadow-[0_0_50px_rgba(255,255,255,0.2)]"
              >
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" />
                
                <div className="mb-8 relative">
                  <motion.div
                    animate={{ 
                      scale: [1, 1.1, 1],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-32 h-32 mx-auto bg-red-50 flex items-center justify-center rounded-full"
                  >
                    <div className="relative">
                      <div className="w-20 h-20 bg-red-500 rounded-full shadow-xl shadow-red-500/20" />
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-6 bg-green-600 rounded-full" />
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-2 bg-green-500 rounded-full rotate-12" />
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-2 bg-green-500 rounded-full -rotate-12" />
                    </div>
                  </motion.div>
                </div>

                <h2 className="text-3xl font-black mb-2 uppercase tracking-tighter italic">Victory!</h2>
                <div className="mb-8">
                  <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-1">Ingredient Found</p>
                  <p className="text-3xl text-red-600 font-black tracking-tighter">TOMATO</p>
                  <p className={cn(
                    "text-sm font-bold mt-2 px-4 py-1 rounded-full inline-block",
                    qualityGrade === 'Perfect' ? "bg-green-100 text-green-700" :
                    qualityGrade === 'Good' ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                  )}>
                    Quality: {qualityGrade}
                  </p>
                </div>

                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-black text-white font-bold rounded-2xl hover:bg-gray-800 transition-all active:scale-95 shadow-xl"
                >
                  Collect Ingredient
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Support Warning */}
        {arSupported === false && (
          <div className="absolute inset-0 z-[100] bg-black flex items-center justify-center p-8 text-center pointer-events-auto">
            <div className="max-w-xs">
              <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full mx-auto mb-6 flex items-center justify-center">
                <X className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-4">WebXR Not Supported</h3>
              <p className="text-white/60 mb-8">
                Your browser or device does not support WebXR. Please use Google Chrome on an ARCore-compatible Android device.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [isHitTestReady, setIsHitTestReady] = useState(false);

  // Sync ref with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    reticle: THREE.Mesh;
    tomato: THREE.Group;
    pathGroup: THREE.Group;
    hitTestSource: XRHitTestSource | null;
    hitTestSourceRequested: boolean;
  } | null>(null);

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
    
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;

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

    // Tomato
    const tomato = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(0.25, 32, 32);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    tomato.add(body);

    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 0.25;
    tomato.add(stem);

    tomato.position.set(0, 0.3, -PATH_LENGTH * DOT_SPACING);
    pathGroup.add(tomato);

    // Final Box
    const boxGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 0.025, -PATH_LENGTH * DOT_SPACING);
    pathGroup.add(box);

    sceneRef.current = { 
      scene, camera, renderer, reticle, tomato, pathGroup, 
      hitTestSource: null, hitTestSourceRequested: false,
      box
    } as any;

    // WebXR Button
    const arButton = ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: containerRef.current }
    });
    document.body.appendChild(arButton);

    // Auto-transition to SCANNING when session starts (fixes iOS Overlay issues)
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
        
        // Anchor the path to the reticle position
        pathGroup.position.setFromMatrixPosition(reticle.matrix);
        
        // Orient path towards the camera but keep it flat on ground
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        const lookPos = new THREE.Vector3(camPos.x, pathGroup.position.y, camPos.z);
        pathGroup.lookAt(lookPos);
        pathGroup.rotateY(Math.PI); // Flip to face away from camera (forward)
        
        pathGroup.visible = true;
        reticle.visible = false;
        setGameState(GAME_STATES.PLACED);
      }
    }

    // Animation Loop
    renderer.setAnimationLoop((timestamp, frame) => {
      if (!sceneRef.current) return;
      const { renderer, scene, camera, reticle, pathGroup, tomato } = sceneRef.current;

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

        // Real-time distance calculation
        if (gameStateRef.current === GAME_STATES.PLACED) {
          const camPos = new THREE.Vector3();
          camera.getWorldPosition(camPos);
          
          const tomatoPos = new THREE.Vector3();
          tomato.getWorldPosition(tomatoPos);
          
          const dist = camPos.distanceTo(tomatoPos);
          setDistance(dist);

          // Success trigger
          if (dist < 0.6) {
            setGameState(GAME_STATES.SUCCESS);
          }
        }
      }

      tomato.rotation.y += 0.02;
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
    <div ref={containerRef} className="fixed inset-0 w-full h-screen overflow-hidden pointer-events-none select-none">
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
                className="absolute bottom-32 w-full px-12 pointer-events-auto"
              >
                <div className="bg-black/40 backdrop-blur-md p-6 rounded-3xl border border-white/10">
                  <div className="flex justify-between items-end mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-white/60">Real Distance</p>
                    <p className="text-xl font-mono font-bold">{distance.toFixed(1)}m</p>
                  </div>
                  <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-red-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(0, Math.min(100, (1 - distance / PATH_LENGTH) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-4 text-[10px] text-white/40 font-bold uppercase tracking-widest">
                    Walk towards the tomato in the real world
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
              className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm pointer-events-auto"
            >
              <motion.div
                initial={{ scale: 0.5, y: 100, rotate: -10 }}
                animate={{ scale: 1, y: 0, rotate: 0 }}
                transition={{ type: 'spring', damping: 12 }}
                className="bg-white text-black p-10 rounded-[3rem] text-center relative overflow-hidden max-w-sm"
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

                <h2 className="text-3xl font-black mb-4 uppercase tracking-tighter italic">Victory!</h2>
                <p className="text-gray-600 font-medium mb-8 leading-relaxed">
                  Congratulations! You have successfully discovered a fresh ingredient:
                  <span className="block text-2xl text-red-600 font-black mt-2">TOMATO</span>
                </p>

                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-black text-white font-bold rounded-2xl hover:bg-gray-800 transition-all active:scale-95"
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

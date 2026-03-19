import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, MapPin, Trophy, Navigation, RefreshCw, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const PATH_LENGTH = 15; // Simulated distance to the prize
const DOT_SPACING = 1.5;
const GAME_STATES = {
  START: 'START',
  HUNTING: 'HUNTING',
  REACHED: 'REACHED',
  SUCCESS: 'SUCCESS',
};

export default function ARGame() {
  const [gameState, setGameState] = useState(GAME_STATES.START);
  const [progress, setProgress] = useState(0); // 0 to 1
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isOriented, setIsOriented] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastStepTime = useRef(0);
  const stepThreshold = 12; // Accelerometer threshold for step detection
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    tomato: THREE.Group;
    pathGroup: THREE.Group;
    box: THREE.Mesh;
  } | null>(null);

  // --- Permissions and Motion Setup ---
  const motionCleanup = useRef<(() => void) | null>(null);

  const requestPermissions = async () => {
    // For iOS 13+
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const orientationRes = await (DeviceOrientationEvent as any).requestPermission();
        const motionRes = await (DeviceMotionEvent as any).requestPermission();
        if (orientationRes === 'granted' && motionRes === 'granted') {
          setNeedsPermission(false);
          motionCleanup.current = setupMotionListeners();
        }
      } catch (err) {
        console.error('Permission error:', err);
      }
    } else {
      // Non-iOS or older versions
      setNeedsPermission(false);
      motionCleanup.current = setupMotionListeners();
    }
  };

  const setupMotionListeners = () => {
    // Device Orientation
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (!sceneRef.current) return;
      setIsOriented(true);
      const { camera } = sceneRef.current;
      
      const alpha = e.alpha ? THREE.MathUtils.degToRad(e.alpha) : 0;
      const beta = e.beta ? THREE.MathUtils.degToRad(e.beta) : 0;
      const gamma = e.gamma ? THREE.MathUtils.degToRad(e.gamma) : 0;

      // Simplified AR orientation
      camera.rotation.set(beta - Math.PI / 2, gamma, alpha, 'YXZ');
    };

    // Step Detection (Device Motion)
    const handleMotion = (e: DeviceMotionEvent) => {
      if (gameState !== GAME_STATES.HUNTING) return;
      
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;

      const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
      const now = Date.now();

      // Detect step based on acceleration spike
      if (magnitude > stepThreshold && now - lastStepTime.current > 400) {
        lastStepTime.current = now;
        setProgress(prev => Math.min(prev + 0.02, 1)); // Advance 2% per step
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  };

  useEffect(() => {
    // Check if we need to ask for permission (iOS specific)
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      setNeedsPermission(true);
    } else {
      motionCleanup.current = setupMotionListeners();
    }

    return () => {
      if (motionCleanup.current) motionCleanup.current();
    };
  }, [gameState]);

  // --- Camera Setup ---
  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
        setCameraError('Unable to access camera. Please ensure permissions are granted.');
      }
    }
    setupCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // --- Three.js Setup ---
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    // Path Group
    const pathGroup = new THREE.Group();
    scene.add(pathGroup);

    // Create Dots and Arrows
    for (let i = 0; i < PATH_LENGTH; i++) {
      // Dot
      const dotGeo = new THREE.SphereGeometry(0.05, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.5 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(0, -1.5, -i * DOT_SPACING - 2);
      pathGroup.add(dot);

      // Arrow (every 3 dots)
      if (i % 3 === 0 && i < PATH_LENGTH - 1) {
        const arrowGeo = new THREE.ConeGeometry(0.1, 0.3, 16);
        const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(0, -1.45, -i * DOT_SPACING - 2.5);
        pathGroup.add(arrow);
      }
    }

    // Final Box
    const boxGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, -1.55, -PATH_LENGTH * DOT_SPACING - 2);
    box.visible = false;
    scene.add(box);

    // 3D Tomato (Group of spheres)
    const tomato = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    tomato.add(body);

    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 0.3;
    tomato.add(stem);

    const leafGeo = new THREE.ConeGeometry(0.05, 0.15, 8);
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(leafGeo, stemMat);
      leaf.position.y = 0.3;
      leaf.rotation.z = Math.PI / 4;
      leaf.rotation.y = (i * Math.PI) / 2;
      tomato.add(leaf);
    }

    tomato.position.set(0, -1.2, -PATH_LENGTH * DOT_SPACING - 2);
    tomato.visible = false;
    scene.add(tomato);

    sceneRef.current = { scene, camera, renderer, tomato, pathGroup, box };

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);
      if (sceneRef.current) {
        const { renderer, scene, camera, tomato } = sceneRef.current;
        tomato.rotation.y += 0.02;
        renderer.render(scene, camera);
      }
    };
    animate();

    // Handle Resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Device Orientation - REMOVED OLD LISTENER (Moved to setupMotionListeners)

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // --- Game Logic ---
  useEffect(() => {
    if (!sceneRef.current) return;
    const { pathGroup, tomato, box } = sceneRef.current;

    if (gameState === GAME_STATES.HUNTING) {
      // Move path towards camera based on progress
      const targetZ = progress * PATH_LENGTH * DOT_SPACING;
      pathGroup.position.z = targetZ;
      tomato.position.z = -PATH_LENGTH * DOT_SPACING - 2 + targetZ;
      box.position.z = -PATH_LENGTH * DOT_SPACING - 2 + targetZ;

      // Show tomato when close
      if (progress > 0.8) {
        tomato.visible = true;
        box.visible = true;
      }

      // Check if reached
      if (progress >= 1) {
        setGameState(GAME_STATES.REACHED);
        setTimeout(() => setGameState(GAME_STATES.SUCCESS), 1000);
      }
    }
  }, [progress, gameState]);

  const startHunt = () => {
    setGameState(GAME_STATES.HUNTING);
    setProgress(0);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-sans text-white">
      {/* Camera Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover opacity-60"
      />

      {/* Three.js Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* UI Overlay */}
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {/* Header */}
        <div className="p-6 flex justify-between items-start pointer-events-auto">
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">Current Quest</p>
              <p className="text-sm font-semibold">Find the Magic Ingredients</p>
            </div>
          </div>
          
          <button 
            onClick={() => window.location.reload()}
            className="p-3 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
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
                  <MapPin className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Ingredients Detected!</h2>
                <p className="text-white/70 text-sm mb-8 leading-relaxed">
                  The magic ingredients are nearby. Follow the path to collect them.
                </p>
                {needsPermission ? (
                  <button
                    onClick={requestPermissions}
                    className="w-full py-4 bg-red-500 text-white font-bold rounded-2xl hover:bg-red-600 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-red-500/40"
                  >
                    <Camera className="w-5 h-5" />
                    Enable AR Sensors
                  </button>
                ) : (
                  <button
                    onClick={startHunt}
                    className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-red-500 hover:text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Navigation className="w-5 h-5" />
                    Start Navigation
                  </button>
                )}
              </motion.div>
            )}

            {gameState === GAME_STATES.HUNTING && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-32 w-full px-12 pointer-events-auto"
              >
                <div className="bg-black/40 backdrop-blur-md p-6 rounded-3xl border border-white/10">
                  <div className="flex justify-between items-end mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-white/60">Remaining Distance</p>
                    <p className="text-xl font-mono font-bold">{Math.max(0, Math.round((1 - progress) * 15))}m</p>
                  </div>
                  <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-red-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-white/40 font-bold uppercase tracking-widest">
                    <motion.div
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="w-1.5 h-1.5 bg-red-500 rounded-full"
                    />
                    Navigating to Destination...
                  </div>
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
                {/* Confetti-like background */}
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
                    {/* 2D Tomato Icon */}
                    <div className="relative">
                      <div className="w-20 h-20 bg-red-500 rounded-full shadow-xl shadow-red-500/20" />
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-6 bg-green-600 rounded-full" />
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-2 bg-green-500 rounded-full rotate-12" />
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-2 bg-green-500 rounded-full -rotate-12" />
                    </div>
                  </motion.div>
                  
                  {/* Sparkles */}
                  <motion.div 
                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="absolute top-0 right-4 w-4 h-4 bg-yellow-400 rounded-full"
                  />
                  <motion.div 
                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
                    transition={{ repeat: Infinity, duration: 1.5, delay: 0.5 }}
                    className="absolute bottom-4 left-4 w-6 h-6 bg-blue-400 rounded-full"
                  />
                </div>

                <h2 className="text-3xl font-black mb-4 uppercase tracking-tighter italic">Victory!</h2>
                <p className="text-gray-600 font-medium mb-8 leading-relaxed">
                  Congratulations! You have successfully discovered a fresh ingredient:
                  <span className="block text-2xl text-red-600 font-black mt-2">TOMATO</span>
                </p>

                <button
                  onClick={() => setGameState(GAME_STATES.START)}
                  className="w-full py-4 bg-black text-white font-bold rounded-2xl hover:bg-gray-800 transition-all active:scale-95"
                >
                  Collect Ingredient
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error State */}
        {cameraError && (
          <div className="absolute inset-0 z-[100] bg-black flex items-center justify-center p-8 text-center pointer-events-auto">
            <div className="max-w-xs">
              <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full mx-auto mb-6 flex items-center justify-center">
                <X className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-4">Camera Required</h3>
              <p className="text-white/60 mb-8">{cameraError}</p>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-white text-black font-bold rounded-2xl"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Orientation Warning */}
        {!isOriented && gameState === GAME_STATES.HUNTING && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-yellow-500 text-black px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest animate-pulse">
            Move your phone to look around
          </div>
        )}
      </div>
    </div>
  );
}

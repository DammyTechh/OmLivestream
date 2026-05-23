'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Sphere } from '@react-three/drei';
import { useRef, Suspense } from 'react';
import * as THREE from 'three';

function MorphBlob({ position, color, scale = 1 }: { position: [number, number, number]; color: string; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.x = state.clock.elapsedTime * 0.15;
    ref.current.rotation.y = state.clock.elapsedTime * 0.2;
  });
  return (
    <Float speed={1.5} rotationIntensity={1.2} floatIntensity={2}>
      <Sphere ref={ref} args={[1.2, 64, 64]} position={position} scale={scale}>
        <MeshDistortMaterial color={color} distort={0.45} speed={2.5} roughness={0.15} metalness={0.6} />
      </Sphere>
    </Float>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 6], fov: 50 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1.5} color="#A855F7" />
        <pointLight position={[-10, -10, -5]} intensity={1} color="#EC4899" />
        <Suspense fallback={null}>
          <MorphBlob position={[-2.4, 1.2, -1]}  color="#7C3AED" scale={0.9} />
          <MorphBlob position={[2.6, -1.4, -2]}  color="#EC4899" scale={1.3} />
          <MorphBlob position={[0, 0, -3]}       color="#A855F7" scale={0.7} />
        </Suspense>
      </Canvas>
    </div>
  );
}

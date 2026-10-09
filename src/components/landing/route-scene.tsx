"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

/**
 * The website's opening scene: freight lanes across a dark map of the US, one truck running its day (drop in
 * Indianapolis, reload to Kansas City, on to Dallas), each next pickup lighting up before the truck gets there.
 * Drawn from shapes only, no model files, so it loads with the page's script.
 */

type City = { name: string; lat: number; lon: number };
const CITIES: City[] = [
  { name: "Seattle", lat: 47.6, lon: -122.3 },
  { name: "Portland", lat: 45.5, lon: -122.7 },
  { name: "Sacramento", lat: 38.6, lon: -121.5 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Phoenix", lat: 33.45, lon: -112.07 },
  { name: "Salt Lake City", lat: 40.76, lon: -111.89 },
  { name: "Denver", lat: 39.74, lon: -104.99 },
  { name: "Albuquerque", lat: 35.08, lon: -106.65 },
  { name: "Dallas", lat: 32.78, lon: -96.8 },
  { name: "Houston", lat: 29.76, lon: -95.37 },
  { name: "San Antonio", lat: 29.42, lon: -98.49 },
  { name: "Oklahoma City", lat: 35.47, lon: -97.52 },
  { name: "Kansas City", lat: 39.1, lon: -94.58 },
  { name: "Omaha", lat: 41.26, lon: -95.93 },
  { name: "Minneapolis", lat: 44.98, lon: -93.27 },
  { name: "Chicago", lat: 41.88, lon: -87.63 },
  { name: "Indianapolis", lat: 39.77, lon: -86.16 },
  { name: "St. Louis", lat: 38.63, lon: -90.2 },
  { name: "Memphis", lat: 35.15, lon: -90.05 },
  { name: "Nashville", lat: 36.16, lon: -86.78 },
  { name: "Atlanta", lat: 33.75, lon: -84.39 },
  { name: "Columbus", lat: 39.96, lon: -83.0 },
  { name: "Detroit", lat: 42.33, lon: -83.05 },
  { name: "Charlotte", lat: 35.23, lon: -80.84 },
  { name: "Jacksonville", lat: 30.33, lon: -81.66 },
  { name: "Harrisburg", lat: 40.27, lon: -76.88 },
  { name: "New York", lat: 40.71, lon: -74.0 },
];

/** Longitude and latitude to the ground plane (x east, z south). */
const at = (c: City) => new THREE.Vector3((c.lon + 97) * 0.21, 0, -(c.lat - 38) * 0.27);
const city = (name: string) => CITIES.find((c) => c.name === name)!;

/** Every lane drawn faintly: the network the truck could run. */
const NETWORK: [string, string][] = [
  ["Seattle", "Portland"], ["Portland", "Sacramento"], ["Sacramento", "Los Angeles"], ["Los Angeles", "Phoenix"], ["Phoenix", "Albuquerque"],
  ["Sacramento", "Salt Lake City"], ["Salt Lake City", "Denver"], ["Portland", "Salt Lake City"], ["Denver", "Albuquerque"], ["Denver", "Omaha"],
  ["Denver", "Kansas City"], ["Albuquerque", "Oklahoma City"], ["Oklahoma City", "Dallas"], ["Dallas", "Houston"], ["Dallas", "San Antonio"],
  ["San Antonio", "Houston"], ["Oklahoma City", "Kansas City"], ["Kansas City", "Omaha"], ["Omaha", "Minneapolis"], ["Minneapolis", "Chicago"],
  ["Kansas City", "St. Louis"], ["St. Louis", "Indianapolis"], ["St. Louis", "Memphis"], ["Dallas", "Memphis"], ["Houston", "Memphis"],
  ["Memphis", "Nashville"], ["Nashville", "Atlanta"], ["Nashville", "Indianapolis"], ["Chicago", "Indianapolis"], ["Chicago", "Detroit"],
  ["Indianapolis", "Columbus"], ["Detroit", "Columbus"], ["Columbus", "Harrisburg"], ["Harrisburg", "New York"], ["Atlanta", "Charlotte"],
  ["Charlotte", "Harrisburg"], ["Atlanta", "Jacksonville"], ["Houston", "Jacksonville"], ["Phoenix", "Dallas"], ["Chicago", "Columbus"],
];

/** The truck's run: loaded legs and the empty miles between them. */
const RUN = ["Memphis", "Indianapolis", "Kansas City", "Dallas", "Memphis"];

const BLUE = new THREE.Color("#276EF1");
const GREEN = new THREE.Color("#06C167");

function routeCurve(names: string[]) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < names.length - 1; i++) {
    const a = at(city(names[i]));
    const b = at(city(names[i + 1]));
    // A gentle bow, the way roads never run straight.
    const mid = a.clone().lerp(b, 0.5);
    const n = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(a.distanceTo(b) * 0.08);
    pts.push(a, mid.add(n));
  }
  pts.push(at(city(names[names.length - 1])));
  return new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
}

/** A dot every so often across the plane, fading out with the fog: the map's texture. */
function DotGround() {
  const geo = useMemo(() => {
    const p: number[] = [];
    for (let x = -14; x <= 14; x += 0.35) for (let z = -6; z <= 6; z += 0.35) p.push(x, -0.01, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#3a3a3a" size={0.035} sizeAttenuation />
    </points>
  );
}

function Network() {
  return (
    <>
      {NETWORK.map(([a, b]) => (
        <Line key={`${a}-${b}`} points={[at(city(a)), at(city(b))]} color="#2b2b2b" lineWidth={1} />
      ))}
      {CITIES.map((c) => (
        <mesh key={c.name} position={at(c)} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.06, 16]} />
          <meshBasicMaterial color="#8a8a8a" />
        </mesh>
      ))}
    </>
  );
}

/** A dry van, from boxes: the trailer, the cab, and a green light on the roof. */
function Truck() {
  return (
    <group scale={0.55}>
      <mesh position={[-0.16, 0.13, 0]}>
        <boxGeometry args={[0.62, 0.22, 0.18]} />
        <meshStandardMaterial color="#f3f3f3" roughness={0.5} />
      </mesh>
      <mesh position={[0.23, 0.1, 0]}>
        <boxGeometry args={[0.16, 0.17, 0.17]} />
        <meshStandardMaterial color="#1f1f1f" roughness={0.4} />
      </mesh>
      <mesh position={[0.23, 0.2, 0]}>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial color={GREEN} />
      </mesh>
      {[-0.38, -0.26, 0.2].map((x) =>
        [-0.095, 0.095].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.03, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.02, 12]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The run: the lane under the truck lit up, the truck on it, and a beam over the next pickup. */
function Run({ still }: { still: boolean }) {
  const curve = useMemo(() => routeCurve(RUN), []);
  const points = useMemo(() => curve.getSpacedPoints(240), [curve]);
  const stops = useMemo(() => RUN.slice(0, -1).map((n) => at(city(n))), []);
  // Where each stop falls along the run (0 to 1), from the nearest of the spaced points.
  const stopsT = useMemo(
    () =>
      stops.map((s) => {
        let bi = 0;
        points.forEach((q, i) => {
          if (q.distanceToSquared(s) < points[bi].distanceToSquared(s)) bi = i;
        });
        return bi / (points.length - 1);
      }),
    [stops, points],
  );
  const truck = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const line = useRef<{ material: { dashOffset: number } } | null>(null);
  const t = useRef(0.08);

  useFrame((_, dt) => {
    if (!still) t.current = (t.current + Math.min(dt, 0.05) * 0.018) % 1;
    const p = curve.getPointAt(t.current);
    const ahead = curve.getPointAt((t.current + 0.002) % 1);
    if (truck.current) {
      truck.current.position.copy(p);
      truck.current.rotation.y = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
    }
    if (line.current && !still) line.current.material.dashOffset -= dt * 0.6;
    // The next pickup: the first stop still ahead of the truck on the run.
    const i = stopsT.findIndex((st) => st > t.current + 0.01);
    const next = stops[i < 0 ? 0 : i];
    const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin(performance.now() / 300);
    if (beam.current) {
      beam.current.position.set(next.x, 0.45, next.z);
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * pulse;
    }
    if (ring.current) {
      ring.current.position.set(next.x, 0.005, next.z);
      ring.current.scale.setScalar(1 + pulse * 0.6);
    }
  });

  return (
    <>
      <Line ref={line as never} points={points} color={BLUE} lineWidth={2.5} dashed dashSize={0.18} gapSize={0.08} />
      {stops.map((s, i) => (
        <mesh key={i} position={[s.x, 0.004, s.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.1, 24]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
      <mesh ref={beam}>
        <cylinderGeometry args={[0.02, 0.02, 0.9, 8]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.17, 32]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.8} />
      </mesh>
      <group ref={truck}>
        <Truck />
      </group>
    </>
  );
}

/**
 * The camera leans with the pointer and lifts as the page scrolls. Wide screens keep the map to the right of the
 * words; on a phone it sits above them.
 */
function Rig({ still }: { still: boolean }) {
  const { camera, pointer, size } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const wide = size.width / size.height > 1.1;
    const scroll = typeof window === "undefined" ? 0 : Math.min(1, window.scrollY / 700);
    const px = still ? 0 : pointer.x;
    const py = still ? 0 : pointer.y;
    // The run (Memphis, Indianapolis, Kansas City, Dallas) is around x 1, z 0.4.
    if (wide) {
      target.set(-1.7, 0, 0.7);
      want.set(-1.3 + px * 1.2, 7.6 + scroll * 2.5 + py * 0.6, 8.2 - scroll * 1.5);
    } else {
      target.set(1.0, 0, 3.0);
      want.set(1.0 + px * 0.6, 8.6 + scroll * 2, 7.6 - scroll);
    }
    camera.position.lerp(want, 0.06);
    camera.lookAt(target);
  });
  return null;
}

export default function RouteScene({ still = false }: { still?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const loop = useRef<((mode: "always" | "demand" | "never") => void) | null>(null);
  // Stop drawing while the scene is scrolled out of view.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => loop.current?.(e.isIntersecting ? (still ? "demand" : "always") : "never"));
    io.observe(el);
    return () => io.disconnect();
  }, [still]);
  return (
    <div ref={wrap} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [-1.3, 7.6, 8.2], fov: 38 }}
        frameloop={still ? "demand" : "always"}
        gl={{ antialias: true, powerPreference: "low-power" }}
        onCreated={(s) => {
          loop.current = s.setFrameloop;
          s.scene.fog = new THREE.Fog("#000000", 8, 18);
        }}
      >
        <color attach="background" args={["#000000"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 6, 4]} intensity={1.4} />
        <DotGround />
        <Network />
        <Run still={still} />
        <Rig still={still} />
      </Canvas>
    </div>
  );
}

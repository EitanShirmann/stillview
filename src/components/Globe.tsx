"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import createGlobe from "cobe";
import type { Stream } from "@/lib/streams";

interface GlobeProps {
  streams: Stream[];
  activeStream: Stream | null;
  onStreamClick: (stream: Stream) => void;
}

interface DotPosition {
  stream: Stream;
  x: number;
  y: number;
  visible: boolean;
  isActive: boolean;
}

/**
 * Exact replication of cobe's marker → screen projection.
 *
 * From cobe source:
 *   let [c,a] = _.location;          // c=lat, a=lng (degrees)
 *   c = c * PI / 180;                // lat → radians
 *   a = a * PI / 180 - PI;           // lng → radians, shifted by PI
 *   let t = cos(c);
 *   e = [-t*cos(a), sin(c), t*sin(a)];   // 3D position on unit sphere
 *
 * The shader rotation matrix J(theta, phi):
 *   mat3(d, f*e, -f*c,  0, c, e,  f, d*-e, d*c)
 *   where c=cos(theta), d=cos(phi), e=sin(theta), f=sin(phi)
 *
 * Then the fragment shader projects with:
 *   a = (gl_FragCoord.xy / w * 2 - 1) / scale
 *   radius check: dot(a,a) <= 0.64  → visible sphere radius = 0.8
 *   l = normalize(vec3(a, sqrt(0.64 - dot(a,a))))
 *   m = l * J(theta, phi)   ← this is the INVERSE rotation
 *
 * So the FORWARD rotation to project a 3D point to screen is J^T (transpose).
 */
function projectToScreen(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
  size: number
): { x: number; y: number; z: number } {
  const PI = Math.PI;

  // Match cobe's marker conversion exactly
  const latRad = (lat * PI) / 180;
  const lngRad = (lng * PI) / 180 - PI;

  const cosLat = Math.cos(latRad);
  // Point on unit sphere (cobe convention)
  const px = -cosLat * Math.cos(lngRad);
  const py = Math.sin(latRad);
  const pz = cosLat * Math.sin(lngRad);

  // J(theta, phi) rotation matrix from cobe shader
  // a=theta, b=phi → c=cos(theta), d=cos(phi), e=sin(theta), f=sin(phi)
  const ct = Math.cos(theta);
  const cp = Math.cos(phi);
  const st = Math.sin(theta);
  const sp = Math.sin(phi);

  // J matrix (column-major in GLSL, row-major here):
  // Row 0: cp,      sp*st,   -sp*ct
  // Row 1: 0,       ct,       st
  // Row 2: sp,      cp*(-st), cp*ct
  //
  // The shader does: m = l * J  (row vector * matrix)
  // meaning J transforms VIEW→WORLD. To go WORLD→VIEW we need J^T.
  //
  // J^T:
  // Row 0: cp,   0,   sp
  // Row 1: sp*st, ct, -cp*st
  // Row 2: -sp*ct, st, cp*ct

  const vx = cp * px + 0 * py + sp * pz;
  const vy = sp * st * px + ct * py + -cp * st * pz;
  const vz = -sp * ct * px + st * py + cp * ct * pz;

  // cobe draws the sphere with visual radius 0.8 of the canvas half-width
  // (from the shader: dot(a,a) <= 0.64 → radius = sqrt(0.64) = 0.8)
  const halfSize = size / 2;
  const sphereRadius = halfSize * 0.8;

  return {
    x: halfSize + vx * sphereRadius,
    y: halfSize - vy * sphereRadius,
    z: vz, // positive = facing camera
  };
}

export default function Globe({
  streams,
  activeStream,
  onStreamClick,
}: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const phiRef = useRef(0);
  const thetaRef = useRef(0.15);
  const dragRef = useRef<{
    x: number;
    y: number;
    phi: number;
    theta: number;
  } | null>(null);
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
  const sizeRef = useRef(0);
  const rafRef = useRef<number>(0);

  const [dots, setDots] = useState<DotPosition[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Update overlay dot positions every frame
  const updateDots = useCallback(() => {
    const size = sizeRef.current;
    if (size) {
      const positions: DotPosition[] = [];
      for (const s of streams) {
        if (s.lat === undefined || s.lng === undefined) continue;
        const { x, y, z } = projectToScreen(
          s.lat,
          s.lng,
          phiRef.current,
          thetaRef.current,
          size
        );
        positions.push({
          stream: s,
          x,
          y,
          visible: z > 0.25,
          isActive: activeStream?.id === s.id,
        });
      }
      setDots(positions);
    }
    rafRef.current = requestAnimationFrame(updateDots);
  }, [streams, activeStream]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateDots);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateDots]);

  // Initialize cobe globe
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const size = containerRef.current.offsetWidth;
    sizeRef.current = size;

    // Rotate toward active stream
    if (activeStream?.lng !== undefined) {
      phiRef.current = -((activeStream.lng * Math.PI) / 180);
    }
    if (activeStream?.lat !== undefined) {
      thetaRef.current = Math.max(
        -0.5,
        Math.min(0.5, (activeStream.lat * Math.PI) / 180 / 3)
      );
    }

    globeRef.current = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: size * 2,
      height: size * 2,
      phi: phiRef.current,
      theta: thetaRef.current,
      dark: 1,
      diffuse: 3,
      mapSamples: 30000,
      mapBrightness: 8,
      baseColor: [0.15, 0.14, 0.12],
      markerColor: [1, 0.85, 0.45],
      glowColor: [0.1, 0.09, 0.06],
      // Cobe markers for the glow effect; HTML dots handle interaction
      markers: streams
        .filter((s) => s.lat !== undefined && s.lng !== undefined)
        .map((s) => ({
          location: [s.lat!, s.lng!] as [number, number],
          size: activeStream?.id === s.id ? 0.08 : 0.04,
        })),
      scale: 1,
      offset: [0, 0],
      onRender: (state) => {
        if (!dragRef.current) {
          phiRef.current += 0.001;
        }
        state.phi = phiRef.current;
        state.theta = thetaRef.current;
        state.width = size * 2;
        state.height = size * 2;
      },
    });

    // Drag
    const onDown = (e: PointerEvent) => {
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        phi: phiRef.current,
        theta: thetaRef.current,
      };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      phiRef.current =
        dragRef.current.phi + (e.clientX - dragRef.current.x) / 150;
      thetaRef.current = Math.max(
        -0.8,
        Math.min(
          0.8,
          dragRef.current.theta - (e.clientY - dragRef.current.y) / 300
        )
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onUp);

    return () => {
      globeRef.current?.destroy();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, [streams, activeStream]);

  return (
    <div ref={containerRef} className="relative w-full aspect-square">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* HTML overlay dots */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {dots.map(
          (dot) =>
            dot.visible && (
              <div
                key={dot.stream.id}
                className="absolute pointer-events-auto"
                style={{
                  left: dot.x,
                  top: dot.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <button
                  className="relative flex items-center justify-center w-8 h-8"
                  onMouseEnter={() => setHoveredId(dot.stream.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStreamClick(dot.stream);
                  }}
                >
                  {/* Dot */}
                  <span
                    className={`block rounded-full transition-all duration-200 ${
                      dot.isActive
                        ? "w-3 h-3 bg-amber-400 shadow-[0_0_10px_2px_rgba(251,191,36,0.5)]"
                        : hoveredId === dot.stream.id
                          ? "w-2.5 h-2.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]"
                          : "w-2 h-2 bg-amber-400/70"
                    }`}
                  />

                  {/* Tooltip on hover */}
                  {hoveredId === dot.stream.id && (
                    <div
                      className="absolute z-[100] pointer-events-none"
                      style={{
                        bottom: "calc(100% + 6px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                      }}
                    >
                      <div className="bg-[#1a1918]/95 backdrop-blur-md border border-[#2a2926] rounded-lg overflow-hidden shadow-2xl">
                        <img
                          src={`https://img.youtube.com/vi/${dot.stream.videoId}/mqdefault.jpg`}
                          alt={dot.stream.location}
                          className="w-48 h-auto block"
                          draggable={false}
                        />
                        <div className="px-3 py-2">
                          <p className="text-[#c4bfb4] text-xs font-light whitespace-nowrap">
                            {dot.stream.location}
                          </p>
                          <p className="text-[#5c5850] text-[10px] italic mt-0.5 whitespace-nowrap">
                            {dot.stream.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <div className="w-2 h-2 bg-[#1a1918]/95 border-r border-b border-[#2a2926] rotate-45 -mt-1" />
                      </div>
                    </div>
                  )}
                </button>
              </div>
            )
        )}
      </div>
    </div>
  );
}

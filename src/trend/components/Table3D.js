import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox, Edges } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Typography, IconButton, Chip, Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import {
  TABLE,
  REGIONS,
  CARD_SLOTS,
  SHOE,
  DISCARD,
  CHIP_DENOMS,
  regionCenter,
} from '../utils/baccaratLayout';
import TrendBoard from './TrendBoard';

// ---------- helpers ----------
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// Hand-tuned HTML overlay positions for the betting region labels.
// (Camera is fixed, so this lines up reliably without a 3D→2D projection in useFrame.)
const LABEL_OVERLAYS = [
  { id: 'player_pair', label: 'P PAIR',  sub: '闲对 · 11:1', left: '12%', top: '34%', big: 12, small: 9 },
  { id: 'player',      label: 'PLAYER',  sub: '闲 · 1:1',    left: '30%', top: '56%', big: 22, small: 11 },
  { id: 'tie',         label: 'TIE',     sub: '和 · 8:1',    left: '50%', top: '44%', big: 16, small: 10 },
  { id: 'banker',      label: 'BANKER',  sub: '庄 · 1:0.95', left: '70%', top: '56%', big: 22, small: 11 },
  { id: 'banker_pair', label: 'B PAIR',  sub: '庄对 · 11:1', left: '88%', top: '34%', big: 12, small: 9 },
];


// Decompose an amount into a stack of chip denominations.
function chipsFor(amount) {
  const stack = [];
  let rem = amount;
  for (const d of CHIP_DENOMS) {
    while (rem >= d.value && stack.length < 18) {
      stack.push(d);
      rem -= d.value;
    }
  }
  return stack;
}

// Seeded RNG so the same hand replays identically.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- table geometry ----------
function TableBody() {
  return (
    <group>
      {/* Wooden rail */}
      <RoundedBox
        args={[TABLE.width + 0.45, 0.22, TABLE.depth + 0.45]}
        radius={TABLE.cornerRadius}
        smoothness={4}
        position={[0, -0.11, 0]}
      >
        <meshStandardMaterial color={TABLE.railColor} roughness={0.6} metalness={0.2} />
      </RoundedBox>
      {/* Felt */}
      <RoundedBox
        args={[TABLE.width, 0.04, TABLE.depth]}
        radius={TABLE.cornerRadius - 0.05}
        smoothness={4}
        position={[0, 0.01, 0]}
      >
        <meshStandardMaterial color={TABLE.feltColor} roughness={0.95} />
      </RoundedBox>
      {/* Decorative inner border line */}
      <mesh position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.001, 0.001, 4]} />
        <meshBasicMaterial color="#fff" />
      </mesh>
    </group>
  );
}

function BettingRegion({ region, highlight }) {
  const c = regionCenter(region);
  const w = c.w * 0.92;
  const d = c.d * 0.86;
  // Brighten the fill so it reads against the felt at the top-down angle.
  const fill = highlight ? '#ffd86b' : brighten(region.fill, 1.6);
  return (
    <group position={[c.x, 0.085, c.z]}>
      {/* Solid colored panel */}
      <mesh>
        <boxGeometry args={[w, 0.06, d]} />
        <meshBasicMaterial color={fill} />
      </mesh>
      {/* Top edge border bars in stroke color for definition */}
      {[
        { p: [0, 0.033, -d / 2 + 0.012], s: [w, 0.012, 0.022] },
        { p: [0, 0.033,  d / 2 - 0.012], s: [w, 0.012, 0.022] },
        { p: [-w / 2 + 0.012, 0.033, 0], s: [0.022, 0.012, d] },
        { p: [ w / 2 - 0.012, 0.033, 0], s: [0.022, 0.012, d] },
      ].map((bar, i) => (
        <mesh key={i} position={bar.p}>
          <boxGeometry args={bar.s} />
          <meshBasicMaterial color={highlight ? '#ffffff' : region.stroke} />
        </mesh>
      ))}
    </group>
  );
}

// Brighten a hex color by a factor (clamped to 255).
function brighten(hex, k) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const c = [1, 2, 3].map(i => Math.min(255, Math.round(parseInt(m[i], 16) * k)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Region labels are rendered as HTML overlays below — keeps GPU memory clean
// and gives crisper text than canvas textures.

// ---------- shoe + discard tray ----------
function DealerEquipment() {
  return (
    <group>
      {/* Shoe */}
      <group position={[SHOE.x, SHOE.h / 2 + 0.03, SHOE.z]}>
        <mesh>
          <boxGeometry args={[SHOE.w, SHOE.h, SHOE.d]} />
          <meshStandardMaterial color="#222" roughness={0.5} metalness={0.3} />
          <Edges color="#888" />
        </mesh>
        {/* Card slot opening */}
        <mesh position={[0, -SHOE.h * 0.15, SHOE.d / 2 + 0.001]}>
          <planeGeometry args={[SHOE.w * 0.7, SHOE.h * 0.18]} />
          <meshBasicMaterial color="#000" />
        </mesh>
      </group>
      {/* Discard tray */}
      <group position={[DISCARD.x, DISCARD.h / 2 + 0.03, DISCARD.z]}>
        <mesh>
          <boxGeometry args={[DISCARD.w, DISCARD.h, DISCARD.d]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
          <Edges color="#555" />
        </mesh>
      </group>
      {/* Dealer button (chip-like puck) */}
      <mesh position={[0, 0.06, -0.85]}>
        <cylinderGeometry args={[0.07, 0.07, 0.018, 32]} />
        <meshStandardMaterial color="#f4f4f4" />
      </mesh>
    </group>
  );
}

// ---------- animated card ----------
function Card({ from, to, value = '?', faceColor = '#fff', delay = 0, duration = 0.6, onArrive }) {
  const ref = useRef();
  const arrivedRef = useRef(false);
  const t0 = useRef(null);

  useFrame((state) => {
    if (!ref.current) return;
    if (t0.current == null) t0.current = state.clock.elapsedTime + delay;
    const elapsed = state.clock.elapsedTime - t0.current;
    if (elapsed < 0) {
      ref.current.visible = false;
      return;
    }
    ref.current.visible = true;
    const t = Math.min(1, elapsed / duration);
    const e = easeOutCubic(t);
    // arc trajectory
    const x = lerp(from.x, to.x, e);
    const z = lerp(from.z, to.z, e);
    const y = 0.06 + Math.sin(e * Math.PI) * 0.18;
    ref.current.position.set(x, y, z);
    ref.current.rotation.y = lerp(0, Math.PI * 2, e);
    ref.current.rotation.z = lerp(0, Math.PI, e); // flip face up
    if (t >= 1 && !arrivedRef.current) {
      arrivedRef.current = true;
      onArrive && onArrive();
    }
  });

  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.10, 0.004, 0.14]} />
        <meshStandardMaterial color={faceColor} roughness={0.4} />
      </mesh>
      {/* Rank pip — solid colored dot, no texture, no font. value is unused
          in this lite renderer (kept in signature for upstream compat). */}
      <mesh position={[0, 0.003, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.001, 16]} />
        <meshBasicMaterial color="#c62828" />
      </mesh>
    </group>
  );
}

// ---------- chip stack ----------
function ChipStack({ position, amount, color }) {
  const chips = useMemo(() => chipsFor(amount), [amount]);
  if (chips.length === 0) return null;
  return (
    <group position={position}>
      {chips.map((c, i) => (
        <mesh key={i} position={[0, 0.018 + i * 0.012, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.012, 24]} />
          <meshStandardMaterial color={color || c.color} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- hand-by-hand state machine ----------
// Phases: 'idle' -> 'betting' -> 'dealing' -> 'reveal' -> 'settle' -> next
function useHandSimulator({ shoeHistory, playing, speed }) {
  const [handIndex, setHandIndex] = useState(0);
  const [phase, setPhase] = useState('betting');
  const [bets, setBets] = useState({});
  const seedRef = useRef(1);

  const totalHands = shoeHistory.length;
  const currentResult = shoeHistory[handIndex] || 'B';

  // Generate per-hand bets (random per-player distribution).
  useEffect(() => {
    const rand = rng(seedRef.current + handIndex * 17);
    const b = {
      player: Math.floor(rand() * 600) + 100,
      banker: Math.floor(rand() * 700) + 100,
      tie: rand() < 0.35 ? Math.floor(rand() * 80) + 20 : 0,
      player_pair: rand() < 0.25 ? Math.floor(rand() * 60) + 20 : 0,
      banker_pair: rand() < 0.25 ? Math.floor(rand() * 60) + 20 : 0,
    };
    setBets(b);
    setPhase('betting');
  }, [handIndex]);

  // Drive the phase clock.
  useEffect(() => {
    if (!playing) return;
    const dur = {
      betting: 1500 / speed,
      dealing: 1800 / speed,
      reveal: 900 / speed,
      settle: 1200 / speed,
    }[phase] || 1000;

    const id = setTimeout(() => {
      if (phase === 'betting') setPhase('dealing');
      else if (phase === 'dealing') setPhase('reveal');
      else if (phase === 'reveal') setPhase('settle');
      else if (phase === 'settle') {
        setHandIndex((h) => (h + 1 >= totalHands ? 0 : h + 1));
      }
    }, dur);
    return () => clearTimeout(id);
  }, [phase, playing, speed, totalHands]);

  return { handIndex, phase, bets, currentResult, totalHands };
}

// ---------- main scene ----------
function Scene({ shoeHistory, playing, speed, onPhaseChange }) {
  const sim = useHandSimulator({ shoeHistory, playing, speed });
  const { phase, bets, currentResult, handIndex, totalHands } = sim;

  useEffect(() => {
    onPhaseChange && onPhaseChange({ phase, handIndex, totalHands, currentResult });
  }, [phase, handIndex, totalHands, currentResult, onPhaseChange]);

  const winningRegion =
    phase === 'reveal' || phase === 'settle'
      ? currentResult === 'B'
        ? 'banker'
        : currentResult === 'P'
        ? 'player'
        : 'tie'
      : null;

  // Cards animate during 'dealing' phase
  const showCards = phase === 'dealing' || phase === 'reveal' || phase === 'settle';
  const cardKey = `${handIndex}-${phase}`;

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 6, 2]} intensity={1.0} castShadow />
      <directionalLight position={[-3, 4, -1]} intensity={0.5} color="#a0c8ff" />
      <pointLight position={[0, 3, 0.5]} intensity={0.6} color="#ffffff" />

      <TableBody />
      {REGIONS.map((r) => (
        <BettingRegion
          key={r.id}
          region={r}
          highlight={winningRegion === r.id}
        />
      ))}
      <DealerEquipment />

      {/* Chips on regions during betting/dealing phases */}
      {(phase === 'betting' || phase === 'dealing' || phase === 'reveal') &&
        REGIONS.map((r) => {
          const c = regionCenter(r);
          const amt = bets[r.id] || 0;
          if (amt === 0) return null;
          return (
            <ChipStack
              key={r.id}
              position={[c.x, 0.12, c.z + c.d * 0.18]}
              amount={amt}
            />
          );
        })}

      {/* Animated cards */}
      {showCards && (
        <>
          <Card
            key={`p1-${cardKey}`}
            from={{ x: SHOE.x, z: SHOE.z + SHOE.d / 2 }}
            to={CARD_SLOTS.player}
            value="?"
            delay={0}
          />
          <Card
            key={`b1-${cardKey}`}
            from={{ x: SHOE.x, z: SHOE.z + SHOE.d / 2 }}
            to={{ x: CARD_SLOTS.banker.x, z: CARD_SLOTS.banker.z }}
            value="?"
            delay={0.3}
          />
          <Card
            key={`p2-${cardKey}`}
            from={{ x: SHOE.x, z: SHOE.z + SHOE.d / 2 }}
            to={{ x: CARD_SLOTS.player.x + 0.12, z: CARD_SLOTS.player.z }}
            value={phase === 'reveal' || phase === 'settle' ? (currentResult === 'P' ? '9' : currentResult === 'B' ? '6' : '8') : '?'}
            delay={0.6}
          />
          <Card
            key={`b2-${cardKey}`}
            from={{ x: SHOE.x, z: SHOE.z + SHOE.d / 2 }}
            to={{ x: CARD_SLOTS.banker.x + 0.12, z: CARD_SLOTS.banker.z }}
            value={phase === 'reveal' || phase === 'settle' ? (currentResult === 'B' ? '9' : currentResult === 'P' ? '6' : '8') : '?'}
            delay={0.9}
          />
        </>
      )}

      <OrbitControls
        enablePan={false}
        minDistance={3.5}
        maxDistance={9}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2.6}
        target={[0, 0, 0.15]}
      />
    </>
  );
}

// ---------- public component ----------
export default function Table3D({ table, data, onClose }) {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [simState, setSimState] = useState({
    phase: 'betting',
    handIndex: 0,
    totalHands: 0,
    currentResult: 'B',
  });

  const shoeHistory = data?.shoeHistory || 'BPBPBBPPBP';

  if (!table || !data) return null;

  const phaseLabel = {
    betting: 'PLACE YOUR BETS · 下注中',
    dealing: 'DEALING · 派牌',
    reveal: 'REVEAL · 开牌',
    settle: 'SETTLE · 派彩',
  }[simState.phase];

  const resultColor = simState.currentResult === 'B' ? '#ff4d4d' : simState.currentResult === 'P' ? '#4d8cff' : '#4dff8c';

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'radial-gradient(ellipse at center, #0a2230 0%, #04101c 70%, #02080f 100%)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          py: 1,
          background: 'linear-gradient(180deg, rgba(4,16,28,0.85), rgba(4,16,28,0))',
        }}
      >
        <IconButton size="small" onClick={onClose} sx={{ color: '#7adfff' }}>
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="overline" sx={{ color: '#7adfff', letterSpacing: 1.5, fontWeight: 700, lineHeight: 1 }}>
            {table.label} · Pit {table.pit} · {data?.min != null ? `$${data.min.toLocaleString()}` : '—'} min
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>
            Shoe #{data.shoeId} · replaying {shoeHistory.length} hands · hand {simState.handIndex + 1}/{simState.totalHands || shoeHistory.length}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          label={phaseLabel}
          sx={{
            bgcolor: 'rgba(122, 200, 220, 0.15)',
            color: '#7adfff',
            border: '1px solid rgba(122,200,220,0.4)',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 1,
          }}
        />
        {(simState.phase === 'reveal' || simState.phase === 'settle') && (
          <Chip
            size="small"
            label={`${simState.currentResult === 'B' ? 'BANKER 庄' : simState.currentResult === 'P' ? 'PLAYER 闲' : 'TIE 和'} WIN`}
            sx={{
              bgcolor: resultColor,
              color: '#fff',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 1,
            }}
          />
        )}
        <IconButton size="small" onClick={() => setPlaying((p) => !p)} sx={{ color: '#fff' }}>
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setSpeed((s) => (s >= 4 ? 0.5 : s * 2))}
          sx={{
            color: '#7adfff',
            borderColor: 'rgba(122,200,220,0.4)',
            minWidth: 56,
            fontSize: 11,
          }}
        >
          {speed}×
        </Button>
      </Box>

      {/* Split layout: 3D canvas on left, TrendBoard side panel on right (no overlay). */}
      <Box sx={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, display: 'flex' }}>
        {/* 3D canvas area */}
        <Box sx={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Canvas
            camera={{ position: [0, 5.0, 2.4], fov: 44 }}
            gl={{ antialias: true }}
            dpr={[1, 1.5]}
            style={{ width: '100%', height: '100%' }}
          >
            <color attach="background" args={['#04101c']} />
            <Scene
              shoeHistory={shoeHistory}
              playing={playing}
              speed={speed}
              onPhaseChange={setSimState}
            />
          </Canvas>
          {/* HTML labels on each betting region (camera is fixed, percentage positions work). */}
          <Box sx={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none' }}>
            {LABEL_OVERLAYS.map((lbl) => (
              <Box
                key={lbl.id}
                sx={{
                  position: 'absolute',
                  left: lbl.left,
                  top: lbl.top,
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  color: '#fff',
                  textShadow: '0 2px 8px rgba(0,0,0,0.85)',
                  fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
                }}
              >
                <Box sx={{ fontWeight: 800, fontSize: lbl.big, letterSpacing: 1, lineHeight: 1 }}>
                  {lbl.label}
                </Box>
                <Box sx={{ fontSize: lbl.small, opacity: 0.85, mt: 0.3, lineHeight: 1 }}>
                  {lbl.sub}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        {/* TrendBoard as a sibling, not an overlay */}
        <Box sx={{ width: 290, flexShrink: 0, p: 1, pt: 0 }}>
          <TrendBoard table={table} data={data} onClose={onClose} />
        </Box>
      </Box>
    </Box>
  );
}

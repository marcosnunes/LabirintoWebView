import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import splashImage from './assets/Splash.png'
import trackBoxStepA from './assets/Box Step Drift.mp3'
import trackBoxStepB from './assets/Box Step Drift (1).mp3'
import trackCrateGardenA from './assets/Crate Garden Drift.mp3'
import trackCrateGardenB from './assets/Crate Garden Drift (1).mp3'
import trackKnittedCornerA from './assets/Knitted Corner Pieces.mp3'
import trackKnittedCornerB from './assets/Knitted Corner Pieces (1).mp3'
import trackTeacupTileA from './assets/Teacup Tile Dance.mp3'
import trackTeacupTileB from './assets/Teacup Tile Dance (1).mp3'
import trackFimDeSemana from './assets/Fim de Semana Relaxante.mp3'
import trackPuzzleGardenA from './assets/Puzzle Garden (Relaxing Mix).mp3'
import trackPuzzleGardenB from './assets/Puzzle Garden (Relaxing Mix) (1).mp3'
import './App.css'

const LEVEL_COUNT_INITIAL = 10
const MAP_WIDTH = 9
const MAP_HEIGHT = 9
const PHASE_MAX_SCORE = 2000
const PHASE_TARGET_MINUTES = 1.0
const OVERTIME_FACTOR = 0.4
const MIN_OVERTIME_SECONDS = 20
const SPLASH_DURATION_MS = 5000
const SAVE_STORAGE_KEY = 'labirinto-save-v1'
const SAVE_SCHEMA_VERSION = 6 // Reset for code structure cleanup
const SPECIAL_HEART_COOLDOWN_MS = 30 * 60 * 1000

const MUSIC_TRACKS = [
  trackBoxStepA, trackBoxStepB, trackCrateGardenA, trackCrateGardenB,
  trackKnittedCornerA, trackKnittedCornerB, trackTeacupTileA, trackTeacupTileB,
  trackFimDeSemana, trackPuzzleGardenA, trackPuzzleGardenB,
]

const KEY_TO_DIRECTION = {
  ArrowUp: { dx: 0, dy: -1 }, ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 }, ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 },
}

const DIRECTIONS = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]

const createRng = (seed) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pickRandom = (rng, list) => list[Math.floor(rng() * list.length)]
const posKey = (pos) => `${pos.x},${pos.y}`
const samePos = (a, b) => a.x === b.x && a.y === b.y
const isInside = (x, y, cols, rows) => x >= 0 && x < cols && y >= 0 && y < rows

const isCornerDeadlock = (box, baseMap, goalSet) => {
  if (goalSet.has(posKey(box))) return false
  const rows = baseMap.length, cols = baseMap[0].length
  const isWall = (x, y) => !isInside(x, y, cols, rows) || baseMap[y][x] === 1
  const up = isWall(box.x, box.y - 1), down = isWall(box.x, box.y + 1)
  const left = isWall(box.x - 1, box.y), right = isWall(box.x + 1, box.y)
  return (up && left) || (up && right) || (down && left) || (down && right)
}

const countBoxesOnGoals = (boxes, goalSet) =>
  boxes.reduce((sum, box) => sum + (goalSet.has(posKey(box)) ? 1 : 0), 0)

const isMapConnected = (map) => {
  const rows = map.length, cols = map[0].length, freeCells = []
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) if (map[y][x] !== 1) freeCells.push({ x, y })
  }
  if (freeCells.length === 0) return false
  const start = freeCells[0], queue = [start], visited = new Set([posKey(start)])
  let cursor = 0
  while (cursor < queue.length) {
    const current = queue[cursor++]
    for (const { dx, dy } of DIRECTIONS) {
      const nx = current.x + dx, ny = current.y + dy
      if (!isInside(nx, ny, cols, rows) || map[ny][nx] === 1) continue
      const key = `${nx},${ny}`
      if (!visited.has(key)) { visited.add(key); queue.push({ x: nx, y: ny }) }
    }
  }
  return visited.size === freeCells.length
}

const addSafeCentralBlockers = (map, rng) => {
  const candidates = []
  for (let y = 2; y < MAP_HEIGHT - 2; y++) {
    for (let x = 2; x < MAP_WIDTH - 2; x++) candidates.push({ x, y, weight: rng() })
  }
  candidates.sort((a, b) => a.weight - b.weight)
  const blockerTarget = 4 + Math.floor(rng() * 4)
  let placed = 0
  for (const cell of candidates) {
    if (placed >= blockerTarget) break
    const { x, y } = cell
    if (map[y][x] !== 0) continue
    map[y][x] = 1
    if (isMapConnected(map)) placed++
    else map[y][x] = 0
  }
}

const generateCandidateLevel = (seed) => {
  const rng = createRng(seed)
  const map = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1 ? 1 : 0)),
  )
  addSafeCentralBlockers(map, rng)
  const freeCells = []
  for (let y = 2; y < MAP_HEIGHT - 2; y++) {
    for (let x = 2; x < MAP_WIDTH - 2; x++) if (map[y][x] === 0) freeCells.push({ x, y })
  }
  if (freeCells.length < 8) return null
  const boxCount = 2, goals = [], goalBlocked = new Set()
  for (let i = 0; i < boxCount; i++) {
    const avail = freeCells.filter(c => !goalBlocked.has(posKey(c)))
    if (avail.length === 0) return null
    const g = pickRandom(rng, avail); goals.push(g); goalBlocked.add(posKey(g)); map[g.y][g.x] = 2
  }
  const boxes = [], blocked = new Set([...goals.map(posKey)])
  for (let i = 0; i < boxCount; i++) {
    const avail = freeCells.filter(c => !blocked.has(posKey(c)))
    if (avail.length === 0) return null
    const b = pickRandom(rng, avail); boxes.push(b); blocked.add(posKey(b))
  }
  const starts = freeCells.filter(c => !blocked.has(posKey(c)))
  if (starts.length === 0) return null
  return { name: `Setor ${seed}`, start: pickRandom(rng, starts), map, boxes }
}

const MANUAL_LEVEL_OVERRIDES = {
  'HEART': {
    name: 'Fase Especial \u2764', start: { x: 4, y: 5 },
    map: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 1, 0, 1, 0, 1, 0, 1], [1, 2, 0, 2, 0, 2, 0, 2, 1],
      [1, 0, 3, 0, 3, 0, 3, 0, 1], [1, 0, 0, 3, 0, 3, 0, 0, 1], [1, 1, 0, 0, 0, 0, 0, 1, 1],
      [1, 1, 1, 0, 3, 0, 1, 1, 1], [1, 1, 1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1]
    ]
  }
}

const parseLevel = (level) => {
  const boxes = [], goals = [], baseMap = level.map.map((row, y) => row.map((cell, x) => {
    if (cell === 3) { boxes.push({ x, y }); return 0 }
    if (cell === 2) goals.push({ x, y })
    return cell
  }))
  return { baseMap, boxes, goals, totalBoxes: boxes.length }
}

const isLevelSolvable = (level) => {
  const parsed = parseLevel(level), goalSet = new Set(parsed.goals.map(posKey))
  const initialState = { p: level.start, b: parsed.boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x)) }
  const stateToKey = (s) => `${s.p.x},${s.p.y}|${s.b.map(posKey).join(';')}`
  const queue = [initialState], visited = new Set([stateToKey(initialState)])
  let iterations = 0, MAX_ITER = 2000
  while (queue.length > 0 && iterations++ < MAX_ITER) {
    const curr = queue.shift()
    if (curr.b.filter(b => goalSet.has(posKey(b))).length === goalSet.size) return true
    for (const { dx, dy } of DIRECTIONS) {
      const np = { x: curr.p.x + dx, y: curr.p.y + dy }
      if (parsed.baseMap[np.y][np.x] === 1) continue
      const bIdx = curr.b.findIndex(b => samePos(b, np))
      if (bIdx !== -1) {
        const nbPos = { x: np.x + dx, y: np.y + dy }
        if (parsed.baseMap[nbPos.y][nbPos.x] === 1 || curr.b.some(b => samePos(b, nbPos))) continue
        if (isCornerDeadlock(nbPos, parsed.baseMap, goalSet)) continue
        const newB = [...curr.b]; newB[bIdx] = nbPos; newB.sort((a, b) => (a.y - b.y) || (a.x - b.x))
        const ns = { p: np, b: newB }, key = stateToKey(ns)
        if (!visited.has(key)) { visited.add(key); queue.push(ns) }
      } else {
        const ns = { p: np, b: curr.b }, key = stateToKey(ns)
        if (!visited.has(key)) { visited.add(key); queue.push(ns) }
      }
    }
  }
  return false
}

const createFallbackLevel = (idx) => ({
  name: `Fase ${idx + 1}`, start: { x: 1, y: 1 },
  map: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 3, 2, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1, 0, 1], [1, 0, 3, 2, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1]
  ]
})

const buildCampaignFast = (count, startIdx = 0, sessionStart = Date.now()) => {
  const campaign = [], timeElapsed = Date.now() - sessionStart
  let currentGlobal = startIdx
  while (campaign.length < count) {
    if (timeElapsed > SPECIAL_HEART_COOLDOWN_MS && currentGlobal > 0 && currentGlobal % 50 === 0) {
       campaign.push({ ...MANUAL_LEVEL_OVERRIDES['HEART'], name: `Fase ${currentGlobal++ + 1} \u2764` }); continue
    }
    let found = false, seed = 93 + (currentGlobal * 131), tries = 0
    while (!found && tries++ < 15) {
      const cand = generateCandidateLevel(seed)
      if (cand) {
        const lvl = { name: `Fase ${currentGlobal + 1}`, start: cand.start, map: cand.map.map(r => [...r]) }
        cand.boxes.forEach(b => { if (lvl.map[b.y][b.x] === 0) lvl.map[b.y][b.x] = 3 })
        if (isLevelSolvable(lvl)) { campaign.push(lvl); found = true }
      }
      seed += 23
    }
    if (!found) campaign.push(createFallbackLevel(currentGlobal))
    currentGlobal++
  }
  return campaign
}

const getOvertimeMs = (tg) => Math.max(MIN_OVERTIME_SECONDS * 1000, tg * OVERTIME_FACTOR)
const computePhaseScore = (el, tg) => Math.max(0, Math.round(PHASE_MAX_SCORE * (1 - Math.min(1, el / tg))))
const computeOvertimeScore = (el, ot, res) => Math.max(0, Math.round(res * (1 - Math.min(1, el / ot))))
const getViewFromHash = () => {
  if (window.location.hash === '#/ajuda') return 'help'
  if (window.location.hash === '#/privacidade') return 'privacy'
  return 'game'
}
const getViewportMetrics = () => ({ width: Math.round(window.visualViewport?.width ?? window.innerWidth ?? 0), height: Math.round(window.visualViewport?.height ?? window.innerHeight ?? 0) })
const DIR_DEG = { down: 0, left: 90, up: 180, right: 270 }
const shortestRotation = (from, toDirName) => {
  const base = DIR_DEG[toDirName]
  const norm = ((from % 360) + 360) % 360
  let diff = base - norm
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return from + diff
}
const normalizeInsets = (i = {}) => ({ top: Math.max(0, Number(i.top) || 0), right: Math.max(0, Number(i.right) || 0), bottom: Math.max(0, Number(i.bottom) || 0), left: Math.max(0, Number(i.left) || 0) })
const createTone = (ctx, { type, frequency, duration, volume, when = 0 }) => {
  const s = ctx.currentTime + when, e = s + duration, osc = ctx.createOscillator(), g = ctx.createGain()
  osc.type = type; osc.frequency.setValueAtTime(frequency, s); g.gain.setValueAtTime(0.0001, s)
  g.gain.exponentialRampToValueAtTime(volume, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, e)
  osc.connect(g); g.connect(ctx.destination); osc.start(s); osc.stop(e + 0.01)
}

function App() {
  const [view, setView] = useState(getViewFromHash)
  const [, setAndroidInsets] = useState(() => normalizeInsets())
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashProgress, setSplashProgress] = useState(0)
  const [levelsReady, setLevelsReady] = useState(false)
  const [levels, setLevels] = useState([])
  const [levelIndex, setLevelIndex] = useState(0)
  const [playerPos, setPlayerPos] = useState({ x: 1, y: 1 })
  const [playerRotation, setPlayerRotation] = useState(0)
  const playerRotationRef = useRef(0)
  const [baseMap, setBaseMap] = useState([])
  const [boxes, setBoxes] = useState([])
  const [goals, setGoals] = useState([])
  const [totalBoxes, setTotalBoxes] = useState(0)
  const [deliveredBoxes, setDeliveredBoxes] = useState(0)
  const [score, setScore] = useState(0)
  const [moves, setMoves] = useState(0)
  const [phaseElapsedSeconds, setPhaseElapsedSeconds] = useState(0)
  const [lastPhaseSeconds, setLastPhaseSeconds] = useState(0)
  const [lastPhaseScore, setLastPhaseScore] = useState(0)
  const [sessionStartTime] = useState(() => Date.now())
  const [phaseComplete, setPhaseComplete] = useState(false)
  const [gameWon, setGameWon] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [isOvertime, setIsOvertime] = useState(false)
  const [overtimeWarningOpen, setOvertimeWarningOpen] = useState(false)
  const [phaseEntryScore, setPhaseEntryScore] = useState(PHASE_MAX_SCORE)
  const [overtimeSecondsLeft, setOvertimeSecondsLeft] = useState(0)
  const audioContextRef = useRef(null)
  const phaseStartTimeRef = useRef(0)
  const overtimeStartTimeRef = useRef(0)
  const hasRestoredSaveRef = useRef(false)
  const [musicEnabled, setMusicEnabled] = useState(false)
  const musicEnabledRef = useRef(false)
  const bgAudioRef = useRef(null)
  const musicQueueRef = useRef([])
  const playNextTrackRef = useRef(() => {})

  const playNextTrack = useCallback(() => {
    if (!musicEnabledRef.current) return
    if (musicQueueRef.current.length === 0) {
      const arr = [...MUSIC_TRACKS]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      musicQueueRef.current = arr
    }
    const src = musicQueueRef.current.shift()
    if (bgAudioRef.current && !bgAudioRef.current.paused && !bgAudioRef.current.ended) return
    if (bgAudioRef.current) { bgAudioRef.current.pause(); bgAudioRef.current.src = '' }
    const audio = new Audio(src); audio.volume = 0.4; bgAudioRef.current = audio
    audio.addEventListener('ended', () => musicEnabledRef.current && playNextTrackRef.current(), { once: true })
    audio.addEventListener('error', () => musicEnabledRef.current && setTimeout(() => playNextTrackRef.current(), 2000), { once: true })
    audio.play().catch(() => {})
  }, [])

  useEffect(() => { playNextTrackRef.current = playNextTrack }, [playNextTrack])
  const navigateToHash = (hash, options = {}) => {
    const { replace = false } = options
    if (replace) window.history.replaceState(null, '', hash)
    else window.location.hash = hash.replace(/^#/, '')
    setView(getViewFromHash())
  }
  const openHelpPage = () => navigateToHash('#/ajuda')
  const closeHelpPage = () => navigateToHash('#/', { replace: true })
  const openPrivacyPage = () => navigateToHash('#/privacidade')
  const closePrivacyPage = () => navigateToHash('#/', { replace: true })
  const toggleMusic = () => {
    const next = !musicEnabledRef.current; musicEnabledRef.current = next; setMusicEnabled(next)
    if (!next) { bgAudioRef.current?.pause(); return }
    if (!bgAudioRef.current || bgAudioRef.current.paused || bgAudioRef.current.ended) playNextTrack()
  }

  useEffect(() => {
    const applyInsets = () => {
      const dpr = window.devicePixelRatio || 1, raw = window.__ANDROID_INSETS__ ?? {}
      const i = normalizeInsets({ top: (Number(raw.top) || 0) / dpr, right: (Number(raw.right) || 0) / dpr, bottom: (Number(raw.bottom) || 0) / dpr, left: (Number(raw.left) || 0) / dpr })
      setAndroidInsets(i); const r = window.document.documentElement
      r.style.setProperty('--android-inset-top', `${i.top}px`); r.style.setProperty('--android-inset-right', `${i.right}px`)
      r.style.setProperty('--android-inset-bottom', `${i.bottom}px`); r.style.setProperty('--android-inset-left', `${i.left}px`)
    }
    const sync = () => setViewport(getViewportMetrics())
    let timer = null; const debouncedSync = () => { clearTimeout(timer); timer = setTimeout(sync, 150) }
    applyInsets(); sync(); const stab = setTimeout(sync, 300)
    window.addEventListener('androidInsetsChanged', applyInsets); window.addEventListener('resize', debouncedSync)
    return () => { clearTimeout(timer); clearTimeout(stab); window.removeEventListener('androidInsetsChanged', applyInsets); window.removeEventListener('resize', debouncedSync) }
  }, [])

  useEffect(() => {
    const start = Date.now(), int = setInterval(() => setSplashProgress(Math.min(1, (Date.now() - start) / SPLASH_DURATION_MS)), 100)
    const tout = setTimeout(() => { setSplashProgress(1); setSplashVisible(false) }, SPLASH_DURATION_MS)
    return () => { clearInterval(int); clearTimeout(tout) }
  }, [])

  useEffect(() => {
    const gen = async () => {
      const raw = window.localStorage.getItem(SAVE_STORAGE_KEY)
      let saved = null
      try { if (raw) { const p = JSON.parse(raw); if (p?.version === SAVE_SCHEMA_VERSION) saved = p } } catch { /* ignore */ }

      if (saved) {
        setLevels(saved.levels); setLevelsReady(true); setLevelIndex(Math.min(saved.levelIndex, saved.levels.length - 1))
        setPlayerPos(saved.playerPos); setBaseMap(saved.baseMap); setBoxes(saved.boxes); setGoals(saved.goals)
        setTotalBoxes(saved.totalBoxes); setDeliveredBoxes(saved.deliveredBoxes); setScore(saved.score); setMoves(saved.moves)
        setPhaseElapsedSeconds(saved.phaseElapsedSeconds); setLastPhaseSeconds(saved.lastPhaseSeconds); setLastPhaseScore(saved.lastPhaseScore)
        setPhaseComplete(saved.phaseComplete); setGameWon(saved.gameWon); setGameOver(saved.gameOver)
        setIsOvertime(saved.isOvertime); setOvertimeWarningOpen(saved.overtimeWarningOpen)
        setPhaseEntryScore(saved.phaseEntryScore); setOvertimeSecondsLeft(saved.overtimeSecondsLeft)
        phaseStartTimeRef.current = Date.now() - (saved.phaseElapsedSeconds * 1000); hasRestoredSaveRef.current = true; return
      }
      const camp = buildCampaignFast(LEVEL_COUNT_INITIAL, 0, sessionStartTime)
      setLevels(camp); setLevelsReady(true)
    }
    gen()
  }, [sessionStartTime])

  useEffect(() => {
    if (!levelsReady || levels.length === 0 || hasRestoredSaveRef.current) { hasRestoredSaveRef.current = false; return }
    const lvl = levels[0], p = parseLevel(lvl)
    setBaseMap(p.baseMap); setBoxes(p.boxes); setGoals(p.goals); setTotalBoxes(p.totalBoxes)
    setDeliveredBoxes(countBoxesOnGoals(p.boxes, new Set(p.goals.map(posKey)))); setPlayerPos(lvl.start)
    const rot = shortestRotation(playerRotationRef.current, 'down')
    playerRotationRef.current = rot
    setPlayerRotation(rot); setScore(PHASE_MAX_SCORE); setPhaseEntryScore(PHASE_MAX_SCORE); phaseStartTimeRef.current = Date.now()
  }, [levelsReady, levels])

  useEffect(() => {
    if (!levelsReady || levels.length === 0) return
    try {
      const payload = { version: SAVE_SCHEMA_VERSION, savedAtMs: Date.now(), levels, levelIndex, playerPos, baseMap, boxes, goals, totalBoxes, deliveredBoxes, score, moves, phaseElapsedSeconds, lastPhaseSeconds, lastPhaseScore, phaseComplete, gameWon, gameOver, isOvertime, overtimeWarningOpen, phaseEntryScore, overtimeSecondsLeft }
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload))
    } catch { /* ignore */ }
  }, [levelsReady, levels, levelIndex, playerPos, baseMap, boxes, goals, totalBoxes, deliveredBoxes, score, moves, phaseElapsedSeconds, lastPhaseSeconds, lastPhaseScore, phaseComplete, gameWon, gameOver, isOvertime, overtimeWarningOpen, phaseEntryScore, overtimeSecondsLeft])

  const audioContext = useCallback(() => {
    if (!audioContextRef.current) audioContextRef.current = new window.AudioContext()
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume()
    return audioContextRef.current
  }, [])

  const playStepSound = useCallback(() => createTone(audioContext(), { type: 'square', frequency: 670, duration: 0.06, volume: 0.03 }), [audioContext])
  const playWallSound = useCallback(() => createTone(audioContext(), { type: 'sawtooth', frequency: 110, duration: 0.16, volume: 0.05 }), [audioContext])
  const playWinArpeggio = useCallback(() => [440, 554.37, 659.25, 880].forEach((f, i) => createTone(audioContext(), { type: 'triangle', frequency: f, duration: 0.3, volume: 0.06, when: i * 0.1 })), [audioContext])
  const playSuccessSound = useCallback(() => { createTone(audioContext(), { type: 'sine', frequency: 880, duration: 0.2, volume: 0.08 }); createTone(audioContext(), { type: 'sine', frequency: 1320, duration: 0.2, volume: 0.04, when: 0.05 }) }, [audioContext])

  const phaseTargetMs = PHASE_TARGET_MINUTES * 60 * 1000
  const overtimeMs = getOvertimeMs(phaseTargetMs)
  const goalsLookup = useMemo(() => new Set(goals.map(posKey)), [goals])
  const currentPhaseScore = useMemo(() => isOvertime ? computeOvertimeScore(Math.max(0, phaseElapsedSeconds * 1000 - phaseTargetMs), overtimeMs, phaseEntryScore) : computePhaseScore(phaseElapsedSeconds * 1000, phaseTargetMs), [isOvertime, overtimeMs, phaseElapsedSeconds, phaseEntryScore, phaseTargetMs])

  const loadLevel = useCallback((idx, opts = {}) => {
    const lvl = levels[idx], p = parseLevel(lvl), otMs = getOvertimeMs(PHASE_TARGET_MINUTES * 60 * 1000)
    setBaseMap(p.baseMap); setBoxes(p.boxes); setGoals(p.goals); setTotalBoxes(p.totalBoxes); setDeliveredBoxes(countBoxesOnGoals(p.boxes, new Set(p.goals.map(posKey))))
    setPlayerPos(lvl.start); setMoves(0); setPhaseElapsedSeconds(0); setLastPhaseSeconds(0); setLastPhaseScore(0); setPhaseComplete(false); setGameWon(false); setGameOver(false); setIsOvertime(false); setOvertimeWarningOpen(false); setOvertimeSecondsLeft(Math.ceil(otMs / 1000)); phaseStartTimeRef.current = Date.now()
    if (opts.resetScore) { setScore(PHASE_MAX_SCORE); setPhaseEntryScore(PHASE_MAX_SCORE) } else setPhaseEntryScore(score)
  }, [levels, score])

  const restartCampaign = () => { setLevelIndex(0); loadLevel(0, { resetScore: true }) }
  const restartCurrentLevel = () => loadLevel(levelIndex)
  const goToNextLevel = () => {
    const next = levelIndex + 1
    if (next >= levels.length - 3) { const n = buildCampaignFast(10, levels.length, sessionStartTime); setLevels(p => [...p, ...n]) }
    setLevelIndex(next); loadLevel(next)
  }

  const movePlayer = useCallback((dir) => {
    if (!dir || phaseComplete || gameWon || gameOver || baseMap.length === 0) return
    const dirName = dir.dx === 1 ? 'right' : dir.dx === -1 ? 'left' : dir.dy === 1 ? 'down' : 'up'
    const rot = shortestRotation(playerRotationRef.current, dirName)
    playerRotationRef.current = rot
    setPlayerRotation(rot)
    const np = { x: playerPos.x + dir.dx, y: playerPos.y + dir.dy }
    const totalCols = baseMap[0].length, totalRows = baseMap.length
    if (!isInside(np.x, np.y, totalCols, totalRows) || baseMap[np.y][np.x] === 1) { playWallSound(); return }
    const bIdx = boxes.findIndex(b => samePos(b, np)); let nextB = boxes
    if (bIdx !== -1) {
      const pp = { x: np.x + dir.dx, y: np.y + dir.dy }
      if (!isInside(pp.x, pp.y, totalCols, totalRows) || baseMap[pp.y][pp.x] === 1 || boxes.some(b => samePos(b, pp))) { playWallSound(); return }
      const wasOn = goalsLookup.has(posKey(np)), nowOn = goalsLookup.has(posKey(pp))
      nextB = boxes.map((b, i) => i === bIdx ? pp : b)
      if (nowOn && !wasOn) {
        playSuccessSound()
        const m = document.querySelector('.maze'); if (m) { const c = m.children[(pp.y * totalCols) + pp.x]; if (c) { c.classList.remove('sparkle-effect'); void c.offsetWidth; c.classList.add('sparkle-effect') } }
      }
    }
    setBoxes(nextB); setPlayerPos(np); setMoves(m => m + 1); const del = countBoxesOnGoals(nextB, goalsLookup); setDeliveredBoxes(del); playStepSound()
    if (del === goals.length && goals.length > 0) {
      const sec = Math.max(1, Math.floor((Date.now() - phaseStartTimeRef.current) / 1000)), pScore = isOvertime ? currentPhaseScore - phaseEntryScore : currentPhaseScore
      setPhaseElapsedSeconds(sec); setLastPhaseSeconds(sec); setLastPhaseScore(pScore); setScore(s => isOvertime ? currentPhaseScore : s + pScore); playWinArpeggio()
      if (levelIndex === levels.length - 1) setGameWon(true); else setPhaseComplete(true)
    }
  }, [phaseComplete, gameWon, gameOver, baseMap, playerPos, boxes, goalsLookup, goals, isOvertime, currentPhaseScore, phaseEntryScore, levelIndex, levels, playWallSound, playSuccessSound, playStepSound, playWinArpeggio])

  const mazeCells = useMemo(() => {
    const bSet = new Set(boxes.map(posKey))
    return baseMap.flatMap((row, y) => row.map((cell, x) => {
      const key = `${x}-${y}`, isP = playerPos.x === x && playerPos.y === y, isB = bSet.has(posKey({ x, y })), isG = cell === 2
      const cls = cell === 1 ? 'wall' : isG ? 'finish' : 'floor'
      return <div key={key} className={`cell ${cls} ${isB ? 'box' : ''} ${isB && isG ? 'box-on-goal' : ''} ${isP ? 'player' : ''}`.trim()} style={isP ? { transform: `rotate(${playerRotation}deg)` } : undefined} />
    }))
  }, [baseMap, boxes, playerPos, playerRotation])

  useEffect(() => {
    const h = (e) => { const d = KEY_TO_DIRECTION[e.key]; if (d) { e.preventDefault(); movePlayer(d) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [movePlayer])

  useEffect(() => {
    if (phaseComplete || gameWon || gameOver) return
    const int = setInterval(() => {
      const ms = Date.now() - phaseStartTimeRef.current, sec = Math.floor(ms / 1000); setPhaseElapsedSeconds(sec)
      if (!isOvertime && ms >= phaseTargetMs) {
        if (score <= 0) { setScore(0); setGameOver(true); return }
        overtimeStartTimeRef.current = Date.now(); setIsOvertime(true); setOvertimeWarningOpen(true); setOvertimeSecondsLeft(Math.ceil(overtimeMs / 1000))
      }
      if (isOvertime) {
        const oms = Date.now() - overtimeStartTimeRef.current, res = computeOvertimeScore(oms, overtimeMs, phaseEntryScore)
        setScore(res); setOvertimeSecondsLeft(Math.ceil(Math.max(0, overtimeMs - oms) / 1000))
        if (res <= 0 || oms >= overtimeMs) { setScore(0); setGameOver(true) }
      }
    }, 100); return () => clearInterval(int)
  }, [gameOver, gameWon, isOvertime, overtimeMs, phaseComplete, phaseEntryScore, phaseTargetMs, score, levelIndex])

  useEffect(() => { const h = () => setView(getViewFromHash()); window.addEventListener('hashchange', h); h(); return () => window.removeEventListener('hashchange', h) }, [])

  const safeViewportWidth = Math.max(320, viewport.width), safeViewportHeight = Math.max(320, viewport.height)
  const isLandscapeViewport = safeViewportWidth > safeViewportHeight, isWideLayout = safeViewportWidth >= 980 || (safeViewportWidth >= 760 && isLandscapeViewport)
  const isNarrowViewport = safeViewportWidth <= 480, isCompactHeight = safeViewportHeight <= 840, isTightHeight = safeViewportHeight <= 760, isVeryTightHeight = safeViewportHeight <= 700
  const shellPaddingX = safeViewportWidth >= 900 ? 24 : isNarrowViewport ? 6 : 12, shellPaddingY = isNarrowViewport ? 0 : isTightHeight ? 2 : isCompactHeight ? 4 : 8
  const layoutGap = isTightHeight ? 4 : 8, sidePanelWidth = isWideLayout ? Math.min(360, Math.max(280, Math.round(safeViewportWidth * 0.3))) : safeViewportWidth
  const controlGap = isWideLayout ? 10 : isVeryTightHeight ? 4 : isTightHeight ? 6 : isCompactHeight ? 8 : 10
  const controlButtonHeight = isWideLayout ? 44 : isVeryTightHeight ? 34 : isTightHeight ? 36 : isCompactHeight ? 40 : 44
  const touchButtonHeight = isWideLayout ? 48 : isVeryTightHeight ? 34 : isTightHeight ? 38 : isCompactHeight ? 42 : 48
  const helpPanelPadding = isVeryTightHeight ? '6px 8px' : '12px'
  const mazeAxis = Math.max(baseMap[0]?.length || MAP_WIDTH, baseMap.length || MAP_HEIGHT)
  const mazeFramePixels = 6 + 4 + Math.max(0, mazeAxis - 1)
  const boardSquareBudget = Math.max(190, Math.min(safeViewportWidth - (isWideLayout ? sidePanelWidth + 60 : 20), safeViewportHeight - 250))
  const cellSize = Math.max(18, Math.min(isWideLayout ? 72 : 60, Math.floor((boardSquareBudget - mazeFramePixels) / mazeAxis)))
  const currentLevel = levels[levelIndex]
  const goalCount = goals.length
  const shellStyle = { '--shell-padding-x': `${shellPaddingX}px`, '--shell-padding-y': `${shellPaddingY}px`, '--side-panel-width': `${sidePanelWidth}px`, '--layout-gap': `${layoutGap}px`, '--hud-title-size': `${isVeryTightHeight ? 1.34 : 1.68}rem`, '--status-card-min-height': `${isVeryTightHeight ? 40 : 50}px`, '--control-gap': `${controlGap}px`, '--control-button-height': `${controlButtonHeight}px`, '--touch-button-height': `${touchButtonHeight}px` }
  const mazeStyle = { '--cell-size': `${cellSize}px`, '--maze-cols': `${baseMap[0]?.length || MAP_WIDTH}`, '--maze-rows': `${baseMap.length || MAP_HEIGHT}` }
  const splashStatusValue = `${Math.round(splashProgress * 100)}%`

  const shellProps = { className: "app-shell", style: shellStyle }
  if (splashVisible) return <div {...shellProps}><div className="crt-overlay" /><main className="game-wrapper splash-wrapper"><section className="splash-screen"><p className="splash-kicker">Novo percurso</p><h1 className="splash-title">Labirinto</h1><div className="splash-art-frame"><img className="splash-art" src={splashImage} /></div><div className="splash-status"><div className="splash-status-bar"><div className="splash-status-fill" style={{ width: `${splashProgress * 100}%` }} /></div><div className="splash-status-copy"><strong>{splashStatusValue}</strong></div></div></section></main></div>
  if (view === 'help') return <div {...shellProps}><div className="crt-overlay" /><main className="game-wrapper help-wrapper"><header className="hud"><h1>Guia do Labirinto</h1></header><section className="help-panel help-panel-upgraded" style={{ padding: helpPanelPadding }}><div className="help-card"><h2>Objetivo</h2><p>Empurre caixas para preencher todos os alvos magenta da fase.</p></div><div className="help-card"><h2>Controles</h2><p>Toque: setas da tela. Teclado: WASD ou setas direcionais.</p></div><div className="help-card"><h2>Dicas Rapidas</h2><p>Evite cantos sem alvo e planeje a posicao final de cada caixa antes do empurrao.</p></div></section><div className="action-buttons"><button onClick={closeHelpPage}>Voltar ao Jogo</button><button onClick={openPrivacyPage}>Politica de Privacidade</button><button className={musicEnabled ? 'music-btn-on' : 'music-btn-off'} onClick={toggleMusic}>{musicEnabled ? '♪ Som: ON' : '♪ Som: OFF'}</button></div></main></div>
  if (view === 'privacy') return <div {...shellProps}><div className="crt-overlay" /><main className="game-wrapper help-wrapper privacy-wrapper"><header className="hud"><h1>Politica de Privacidade</h1></header><section className="help-panel privacy-panel" style={{ padding: helpPanelPadding }}><p>Esta politica descreve como o aplicativo Labirinto lida com suas informacoes.</p><h2>1. Coleta de Informacoes</h2><p>O aplicativo Labirinto nao coleta, nao armazena e nao compartilha dados pessoais, identificadores de dispositivo ou localizacao.</p><h2>2. Armazenamento Local</h2><p>O jogo usa armazenamento local para salvar progresso, fase atual, pontuacao e configuracao de audio. Esses dados ficam apenas no seu aparelho.</p><h2>3. Servicos de Terceiros</h2><p>O aplicativo nao usa redes de anuncios ou analytics para coletar dados que identifiquem voce.</p><h2>4. Links Externos</h2><p>O app roda em WebView e nao abre sites externos automaticamente.</p><h2>5. Privacidade das Criancas</h2><p>Como nao coletamos dados pessoais, o app e adequado para usuarios de todas as idades.</p><h2>6. Alteracoes nesta Politica</h2><p>Esta politica pode ser atualizada periodicamente para refletir melhorias no app.</p><h2>7. Contato</h2><p>Em caso de duvidas, use o contato do desenvolvedor disponivel na loja de aplicativos.</p><p className="privacy-footer">Ultima atualizacao: Marco de 2026</p></section><div className="action-buttons"><button onClick={closePrivacyPage}>Voltar ao Jogo</button><button onClick={openHelpPage}>Voltar a Ajuda</button></div></main></div>
  if (!levelsReady || !currentLevel) return <div {...shellProps}><div className="crt-overlay" /><main className="game-wrapper splash-wrapper"><header className="hud"><h1 className="splash-title">Labirinto</h1></header><section className="splash-screen" style={{ gridTemplateRows: 'auto auto auto' }}><div className="splash-art-frame" style={{ width: 'min(100%, 300px)' }}><img className="splash-art" src={splashImage} /></div><div className="loading-container"><p className="loading-title" style={{ fontSize: '1.4rem', color: '#ff00ff', textShadow: '0 0 10px rgba(255,0,255,0.5)' }}>Arquitetando Caminhos...</p><div className="splash-status-bar" style={{ width: '280px', height: '20px', margin: '15px auto', border: '3px solid #ff00ff' }}><div className="splash-status-fill" style={{ width: '100%', background: 'linear-gradient(90deg, #ff00ff, #00ffff)', animation: 'loading-pulse 1s infinite' }} /></div><p className="loading-subtitle" style={{ fontSize: '1rem', color: '#4a3118', fontWeight: 'bold' }}>Desenhando o Setor {levelIndex + 1}...</p></div><div className="help-panel" style={{ fontSize: '0.8rem', opacity: 0.8, maxWidth: '300px' }}><strong>Dica:</strong> Planeje cada movimento!</div></section></main></div>

  const remSec = Math.max(0, Math.floor(phaseTargetMs / 1000) - phaseElapsedSeconds)
  return (
    <div {...shellProps}><div className="crt-overlay" /><main className={`game-wrapper ${isWideLayout ? 'game-wrapper-wide' : ''}`}><header className="hud"><h1>Labirinto</h1><div className="status-grid"><div className="status-card"><span className="status-label">Alvos</span><strong className="status-value">{deliveredBoxes}/{goalCount}</strong></div><div className={`status-card ${isOvertime ? 'status-card-warning' : ''}`}><span className="status-label">{isOvertime ? 'Prorrogacao' : 'Tempo'}</span><strong className="status-value">{isOvertime ? `${overtimeSecondsLeft}s` : `${remSec}s`}</strong></div><div className="status-card"><span className="status-label">Pontos</span><strong className="status-value">{score}</strong></div><div className="status-card"><span className="status-label">Movimentos</span><strong className="status-value">{moves}</strong></div><div className="status-card status-card-wide"><span className="status-label">Fase</span><strong className="status-value">{levelIndex + 1}</strong></div></div></header><section className={`game-layout ${isWideLayout ? 'game-layout-wide' : ''}`}><div className="board-panel"><section className="maze" style={mazeStyle}>{mazeCells}</section></div><aside className="control-panel"><div className="action-buttons"><button onClick={restartCurrentLevel}>Reiniciar Fase</button><button onClick={restartCampaign}>Reiniciar Campanha</button></div><section className="help-section"><button className="tutorial-link" onClick={openHelpPage}>Como Jogar?</button></section><section className="touch-controls"><button className="touch-btn btn-up" onPointerDown={(e) => { e.preventDefault(); movePlayer({ dx: 0, dy: -1 }) }}>▲</button><button className="touch-btn btn-left" onPointerDown={(e) => { e.preventDefault(); movePlayer({ dx: -1, dy: 0 }) }}>◀</button><button className="touch-btn btn-down" onPointerDown={(e) => { e.preventDefault(); movePlayer({ dx: 0, dy: 1 }) }}>▼</button><button className="touch-btn btn-right" onPointerDown={(e) => { e.preventDefault(); movePlayer({ dx: 1, dy: 0 }) }}>▶</button></section></aside></section></main>
      {overtimeWarningOpen && !gameOver && !phaseComplete && <section className="victory-modal"><div className="victory-panel"><h2>PRORROGACAO ATIVA</h2><p>Sua pontuacao esta sendo consumida!</p><button onClick={() => setOvertimeWarningOpen(false)}>Continuar</button></div></section>}
      {phaseComplete && <section className="victory-modal"><div className="victory-panel"><h2>Fase Concluída</h2><p>Tempo: {lastPhaseSeconds}s</p><button onClick={goToNextLevel}>Proxima</button></div></section>}
      {gameWon && <section className="victory-modal"><div className="victory-panel"><h2>Vitoria!</h2><p>Pontos: {score}</p><button onClick={restartCampaign}>Denovo</button></div></section>}
      {gameOver && <section className="victory-modal"><div className="victory-panel"><h2>Derrota</h2><p>O tempo e os pontos acabaram.</p><button onClick={restartCampaign}>Recomeçar</button></div></section>}
    </div>
  )
}
export default App

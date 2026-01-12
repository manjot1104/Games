/**
 * Drive Car on Curvy Road Game
 * A hand-tracking game where kids drive a car along a curvy road using their index finger
 * Features: 5 difficulty levels, timer, road tracking, scoring, and beautiful UI
 */

import { useHandDetectionWeb } from '@/hooks/useHandDetectionWeb';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
};

interface Point {
  x: number;
  y: number;
}

interface RoundResult {
  round: number;
  coverage: number;
  stars: number;
  offRoadPenalty: number;
  timeRemaining: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const COVERAGE_TARGET = 0.70; // 70% coverage needed
const ROAD_TOLERANCE = 60; // pixels
const ROAD_WIDTH = 80; // Road width
const CAR_SIZE = 60; // Car size
const DEFAULT_TTS_RATE = 0.75;

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

// Enhanced Kalman-like smoother for finger tracking
class KalmanSmoother {
  private x = 0;
  private y = 0;
  private vx = 0; // velocity x
  private vy = 0; // velocity y
  private initialized = false;
  private readonly alpha = 0.85; // Smoothing factor

  update(nx: number, ny: number): Point {
    if (!this.initialized) {
      this.x = nx;
      this.y = ny;
      this.initialized = true;
      return { x: this.x, y: this.y };
    }

    // Predict position based on velocity
    const predictedX = this.x + this.vx;
    const predictedY = this.y + this.vy;

    // Update with measurement (exponential smoothing with velocity)
    const dx = nx - predictedX;
    const dy = ny - predictedY;

    this.x = predictedX + this.alpha * dx;
    this.y = predictedY + this.alpha * dy;

    // Update velocity (exponential moving average)
    this.vx = this.vx * 0.7 + (this.x - (this.x - dx)) * 0.3;
    this.vy = this.vy * 0.7 + (this.y - (this.y - dy)) * 0.3;

    return { x: this.x, y: this.y };
  }

  reset() {
    this.initialized = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
  }
}

// Generate different curvy road paths based on round difficulty
function generateRoadPath(width: number, height: number, round: number): Point[] {
  const points: Point[] = [];
  const startX = width * 0.1;
  const endX = width * 0.9;
  const numPoints = 150 + (round * 20); // More points for higher rounds

  switch (round) {
    case 1: {
      // Round 1: Gentle curve
      const centerY = height * 0.5;
      const amplitude = height * 0.15;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t;
        const y = centerY + amplitude * Math.sin(t * Math.PI);
        points.push({ x, y });
      }
      break;
    }
    case 2: {
      // Round 2: Longer curve with more variation
      const centerY = height * 0.5;
      const amplitude = height * 0.2;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t;
        const y = centerY + amplitude * Math.sin(t * Math.PI * 1.5);
        points.push({ x, y });
      }
      break;
    }
    case 3: {
      // Round 3: Zig-zag road
      const centerY = height * 0.5;
      const amplitude = height * 0.18;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t;
        const y = centerY + amplitude * Math.sin(t * Math.PI * 3);
        points.push({ x, y });
      }
      break;
    }
    case 4: {
      // Round 4: Spiral-like curves
      const centerY = height * 0.5;
      const amplitude = height * 0.22;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t;
        const y = centerY + amplitude * Math.sin(t * Math.PI * 2) * (1 - t * 0.2);
        points.push({ x, y });
      }
      break;
    }
    case 5: {
      // Round 5: Narrow winding road
      const centerY = height * 0.5;
      const amplitude = height * 0.25;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t;
        const y = centerY + amplitude * Math.sin(t * Math.PI * 4) * (0.6 + t * 0.4);
        points.push({ x, y });
      }
      break;
    }
  }

  return points;
}

// Calculate distance from point to nearest road segment
function distanceToRoad(point: Point, road: Point[]): number {
  let minDist = Infinity;
  for (let i = 0; i < road.length - 1; i++) {
    const p1 = road[i];
    const p2 = road[i + 1];
    const dist = pointToLineDistance(point, p1, p2);
    minDist = Math.min(minDist, dist);
  }
  return minDist;
}

// Calculate distance from point to line segment
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Convert normalized coordinates to screen coordinates
function convertToScreenCoords(
  normalized: { x: number; y: number },
  videoRect: DOMRect,
  gameRect: DOMRect
): Point | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return null;
  }

  try {
    let x = videoRect.left + normalized.x * videoRect.width;
    let y = videoRect.top + normalized.y * videoRect.height;

    // Check if video is mirrored
    const video = document.querySelector('video[data-hand-preview-video]') as HTMLVideoElement;
    if (video) {
      const style = window.getComputedStyle(video);
      if (style.transform.includes('scaleX(-1)') || style.transform.includes('matrix(-1')) {
        x = videoRect.left + (1 - normalized.x) * videoRect.width;
      }
    }

    const result = {
      x: x - gameRect.left,
      y: y - gameRect.top,
    };

    if (isNaN(result.x) || isNaN(result.y) || !isFinite(result.x) || !isFinite(result.y)) {
      return null;
    }

    return result;
  } catch (error) {
    return null;
  }
}

// Simple Web Audio sound effects
class SoundEffects {
  private audioContext: AudioContext | null = null;

  init() {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.AudioContext) {
      try {
        this.audioContext = new AudioContext();
      } catch (e) {
        console.warn('AudioContext not available:', e);
      }
    }
  }

  playTone(frequency: number, duration: number, type: 'sine' | 'square' | 'triangle' = 'sine') {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  playStartChime() {
    this.playTone(523.25, 0.2); // C5
    setTimeout(() => this.playTone(659.25, 0.2), 100); // E5
    setTimeout(() => this.playTone(783.99, 0.3), 200); // G5
  }

  playSuccess() {
    this.playTone(523.25, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 0.15), 80); // E5
    setTimeout(() => this.playTone(783.99, 0.15), 160); // G5
    setTimeout(() => this.playTone(1046.50, 0.3), 240); // C6
  }

  playCountdown() {
    this.playTone(440, 0.1, 'square'); // A4
  }

  playEngine() {
    this.playTone(200, 0.05, 'square'); // Low engine sound
  }
}

export function DriveCarCurvyRoadGame({ onBack, onComplete }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const handDetection = useHandDetectionWeb(true);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [gameRect, setGameRect] = useState({ width: 0, height: 0 });
  const [currentRound, setCurrentRound] = useState(1);
  const [roadPath, setRoadPath] = useState<Point[]>([]);
  const [carPosition, setCarPosition] = useState<Point | null>(null);
  const [coverage, setCoverage] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_TIME_MS);
  const [countdown, setCountdown] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    averageCoverage: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [offRoadPenalty, setOffRoadPenalty] = useState(0);
  const [isOnRoad, setIsOnRoad] = useState(true);
  const [carRotation, setCarRotation] = useState(0);

  // Refs
  const smoother = useRef(new KalmanSmoother());
  const coveredSegments = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundEffects = useRef(new SoundEffects());
  const confettiAnimation = useRef(new Animated.Value(0)).current;
  const lastProgressAnnouncement = useRef(0);
  const finishGameRef = useRef<(() => void) | undefined>(undefined);
  const [hasWarned10, setHasWarned10] = useState(false);
  const [hasWarned5, setHasWarned5] = useState(false);
  const [lastHandWarning, setLastHandWarning] = useState(0);

  // Initialize sound effects
  useEffect(() => {
    soundEffects.current.init();
  }, []);

  // Generate road path when game area is ready or round changes
  useEffect(() => {
    if (gameRect.width > 0 && gameRect.height > 0 && currentRound <= TOTAL_ROUNDS) {
      const path = generateRoadPath(gameRect.width, gameRect.height, currentRound);
      setRoadPath(path);
      smoother.current.reset();
      setCoverage(0);
      setOffRoadPenalty(0);
      coveredSegments.current.clear();
      lastProgressAnnouncement.current = 0;
      
      // Set car to start position
      if (path.length > 0) {
        setCarPosition(path[0]);
      }
    }
  }, [gameRect.width, gameRect.height, currentRound]);

  // Update coverage when car moves
  const updateCoverage = useCallback((point: Point) => {
    if (!roadPath.length) return;

    // Check which road segments are near the car
    const tolerance = ROAD_TOLERANCE;
    let newSegmentsCovered = 0;

    for (let i = 0; i < roadPath.length; i++) {
      if (coveredSegments.current.has(i)) continue; // Already covered
      
      const roadPoint = roadPath[i];
      const dist = Math.hypot(point.x - roadPoint.x, point.y - roadPoint.y);
      
      if (dist < tolerance) {
        coveredSegments.current.add(i);
        newSegmentsCovered++;
      }
    }

    // Update coverage based on segments covered
    const newCoverage = roadPath.length > 0 
      ? coveredSegments.current.size / roadPath.length 
      : 0;
    
    if (newCoverage > coverage) {
      setCoverage(newCoverage);
    }

    // Check if on road
    const distToRoad = distanceToRoad(point, roadPath);
    const onRoad = distToRoad < ROAD_TOLERANCE;
    setIsOnRoad(onRoad);

    // Calculate off-road penalty
    if (distToRoad > ROAD_TOLERANCE * 2) {
      setOffRoadPenalty(prev => prev + 1);
    }

    // Calculate car rotation based on road direction
    if (roadPath.length > 0 && onRoad) {
      let minDist = Infinity;
      let closestIndex = 0;
      for (let i = 0; i < roadPath.length; i++) {
        const dist = Math.hypot(point.x - roadPath[i].x, point.y - roadPath[i].y);
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }

      if (closestIndex > 0 && closestIndex < roadPath.length - 1) {
        const prevPoint = roadPath[closestIndex - 1];
        const nextPoint = roadPath[closestIndex + 1];
        const angle = Math.atan2(nextPoint.y - prevPoint.y, nextPoint.x - prevPoint.x);
        setCarRotation(angle * (180 / Math.PI));
      }
    }
  }, [roadPath, coverage]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    if (currentRound === 1) {
      speak(
        'Welcome to Drive the Car! Use your index finger to drive the car along the curvy road. ' +
        'Stay on the road and cover at least 70 percent to complete each round. ' +
        'Show your index finger in the center box to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your index finger in the center box when you're ready!`);
    }
  }, [currentRound]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    soundEffects.current.playCountdown();

    // Round-specific instructions
    let instruction = '';
    switch (currentRound) {
      case 1:
        instruction = 'Round 1! Drive along the gentle curve. Follow the road carefully.';
        break;
      case 2:
        instruction = 'Round 2! This road has more curves. Stay on the path.';
        break;
      case 3:
        instruction = 'Round 3! Zig-zag road ahead. Drive smoothly through all the turns.';
        break;
      case 4:
        instruction = 'Round 4! Spiral curves coming up. Follow the winding road.';
        break;
      case 5:
        instruction = 'Round 5! Final round - narrow winding road. Take your time and drive carefully!';
        break;
    }
    speak(instruction + ' Get ready!');

    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          setGameState('playing');
          setTimeRemaining(ROUND_TIME_MS);
          soundEffects.current.playStartChime();
          speak('Go! Drive the car now! You have 20 seconds!');
          return 0;
        }
        soundEffects.current.playCountdown();
        speak(prev.toString());
        return prev - 1;
      });
    }, 1000);

    countdownRef.current = countdownInterval as ReturnType<typeof setInterval>;
  }, [currentRound]);

  // Start round
  useEffect(() => {
    if (gameState === 'calibration' && handDetection.landmarks?.indexFingerTip) {
      // Check if finger is in calibration box (center area)
      const video = Platform.OS === 'web' && typeof document !== 'undefined'
        ? document.querySelector('video[data-hand-preview-video]') as HTMLVideoElement
        : null;
      const gameArea = Platform.OS === 'web' && typeof document !== 'undefined'
        ? (document.querySelector('[data-game-area]') as HTMLElement || document.querySelector('svg') as SVGSVGElement)
        : null;

      if (video && gameArea) {
        const videoRect = video.getBoundingClientRect();
        const gRect = (gameArea as HTMLElement | SVGSVGElement).getBoundingClientRect();
        const screenCoords = convertToScreenCoords(handDetection.landmarks.indexFingerTip, videoRect, gRect);

        if (screenCoords) {
          const centerX = gameRect.width / 2;
          const centerY = gameRect.height / 2;
          const boxSize = 100;

          if (
            Math.abs(screenCoords.x - centerX) < boxSize &&
            Math.abs(screenCoords.y - centerY) < boxSize
          ) {
    setTimeout(() => {
              startCountdown();
            }, 500);
          }
        }
      }
    }
  }, [gameState, handDetection.landmarks, gameRect, startCountdown]);

  // Timer countdown with voice warnings
  useEffect(() => {
    if (gameState === 'playing') {
      setHasWarned10(false);
      setHasWarned5(false);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'playing' && timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          // Voice warnings
          if (prev <= 11000 && prev > 10000 && !hasWarned10) {
            setHasWarned10(true);
            speak('10 seconds remaining! Keep driving!');
          }
          if (prev <= 6000 && prev > 5000 && !hasWarned5) {
            setHasWarned5(true);
            speak('5 seconds left! Drive faster!');
          }
          
          if (prev <= 1000) {
            // Time's up - end round
            speak('Time\'s up!');
    setTimeout(() => {
              endRound();
            }, 500);
            return 0;
          }
          return prev - 1000;
        });
      }, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [gameState, timeRemaining, hasWarned10, hasWarned5]);

  // End round
  const endRound = useCallback(() => {
    // Use functional state updates to get current values
    setGameState(prevState => {
      if (prevState !== 'playing') return prevState;
      
      setGameState('roundComplete');

      // Calculate stars (1-3)
      let stars = 0;
      if (coverage >= COVERAGE_TARGET) {
        if (coverage >= 0.9 && offRoadPenalty < 10) {
          stars = 3;
        } else if (coverage >= 0.8) {
          stars = 2;
        } else {
          stars = 1;
        }
      }

      const result: RoundResult = {
        round: currentRound,
        coverage,
        stars,
        offRoadPenalty,
        timeRemaining,
      };

      setRoundResults(prev => [...prev, result]);
      setTotalStars(prev => prev + stars);

      soundEffects.current.playSuccess();
      
      // Show success animation instead of TTS
      setShowRoundSuccess(true);

      // Use functional update to get the actual current round value
      setCurrentRound(prevRound => {
        const nextRound = prevRound + 1;
        
        if (prevRound < TOTAL_ROUNDS) {
          setTimeout(() => {
            setShowRoundSuccess(false);
            speak(`Get ready for round ${nextRound}!`);
            setTimeout(() => {
              setCurrentRound(nextRound);
              setGameState('calibration');
              startCalibration();
            }, 2000);
          }, 2500);
        } else {
          // All rounds complete
          setTimeout(() => {
            setShowRoundSuccess(false);
            finishGameRef.current?.();
          }, 2500);
        }
        
        return prevRound; // Don't change it here, we'll set it in setTimeout
      });

      return 'roundComplete';
    });
  }, [coverage, offRoadPenalty, timeRemaining, currentRound, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');

    const averageCoverage = roundResults.reduce((sum, r) => sum + r.coverage, 0) / roundResults.length;
    const accuracy = Math.round(averageCoverage * 100);

    const stats = {
      totalRounds: TOTAL_ROUNDS,
      averageCoverage,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    // Confetti animation
    Animated.sequence([
      Animated.timing(confettiAnimation, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(confettiAnimation, {
        toValue: 0,
        duration: 500,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    soundEffects.current.playSuccess();
    speak(`Amazing! You completed all ${TOTAL_ROUNDS} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'drive-car-curvy-road',
        correct: totalStars,
        total: TOTAL_ROUNDS * 3, // Max possible stars
        accuracy,
        xpAwarded,
        skillTags: ['hand-tracking', 'fine-motor', 'visual-motor', 'attention', 'driving'],
        meta: {
          totalRounds: TOTAL_ROUNDS,
          averageCoverage,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, onComplete, confettiAnimation]);

  // Update ref when finishGame changes
  useEffect(() => {
    finishGameRef.current = finishGame;
  }, [finishGame]);

  // Track hand detection and provide feedback
  useEffect(() => {
    if (gameState === 'playing' && !handDetection.landmarks?.indexFingerTip) {
      const now = Date.now();
      if (now - lastHandWarning > 3000) {
        setLastHandWarning(now);
        speak('Show your index finger to drive the car!');
      }
    }
  }, [gameState, handDetection.landmarks, lastHandWarning]);

  // Track index finger and update car position
  useEffect(() => {
    if (
      gameState !== 'playing' ||
      !handDetection.landmarks?.indexFingerTip ||
      !roadPath.length
    ) {
      setCarPosition(null);
      return;
    }

    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    const updatePosition = () => {
      const video = document.querySelector('video[data-hand-preview-video]') as HTMLVideoElement;
      const gameArea = document.querySelector('[data-game-area]') as HTMLElement ||
        document.querySelector('svg') as SVGSVGElement;

      if (!video || !gameArea) {
        return;
      }

      const videoRect = video.getBoundingClientRect();
      const gameRect = (gameArea as HTMLElement | SVGSVGElement).getBoundingClientRect();

      const screenCoords = convertToScreenCoords(
        handDetection.landmarks!.indexFingerTip!,
        videoRect,
        gameRect
      );

      if (!screenCoords) {
        setCarPosition(null);
        return;
      }

      // Smooth the position
      const smoothed = smoother.current.update(screenCoords.x, screenCoords.y);
      setCarPosition(smoothed);

      // Update coverage
      updateCoverage(smoothed);

      // Check if coverage target reached
      if (coverage >= COVERAGE_TARGET && timeRemaining > 0) {
        speak('Great job! You reached the target!');
        setTimeout(() => {
          endRound();
        }, 1000);
      }
      
      // Progress encouragement (only once per milestone)
      const coveragePercent = Math.round(coverage * 100);
      const now = Date.now();
      if ((coveragePercent === 50 || coveragePercent === 60) && now - lastProgressAnnouncement.current > 3000) {
        lastProgressAnnouncement.current = now;
        speak(`You're at ${coveragePercent} percent! Keep going!`);
      }
    };

    updatePosition();
    const interval = setInterval(updatePosition, 33); // ~30 FPS
    return () => clearInterval(interval);
  }, [gameState, handDetection.landmarks, roadPath, coverage, timeRemaining, updateCoverage, endRound]);

  // Initialize on mount
  useEffect(() => {
    startCalibration();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current as any);
      clearScheduledSpeech();
    };
  }, [startCalibration]);

  // Create SVG path string
  const pathString = roadPath.length > 0
    ? `M ${roadPath[0].x} ${roadPath[0].y} ` +
    roadPath.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
    : '';

  if (gameState === 'gameComplete' && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={totalStars}
        total={TOTAL_ROUNDS * 3}
        accuracy={finalStats.accuracy}
        xpAwarded={totalStars * 50}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Sky gradient background */}
      <LinearGradient
        colors={['#87CEEB', '#E0F6FF', '#FFFFFF']}
        style={StyleSheet.absoluteFillObject}
      />

        {/* Header */}
      <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Drive the Car</Text>
          {gameState !== 'gameComplete' && (
            <Text style={styles.roundText}>Round {currentRound}/{TOTAL_ROUNDS}</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {gameState === 'playing' && (
            <View style={styles.timerContainer}>
              <Ionicons name="time-outline" size={20} color="#0F172A" />
              <Text style={styles.timerText}>{Math.ceil(timeRemaining / 1000)}s</Text>
            </View>
          )}
          {roundResults.length > 0 && (
            <View style={styles.starsContainer}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name={i < roundResults[roundResults.length - 1].stars ? "star" : "star-outline"}
                  size={20}
                  color="#FCD34D"
                />
              ))}
            </View>
          )}
          </View>
        </View>

      {/* Main Game Area */}
      <View style={styles.gameContainer}>
        {/* Camera Preview */}
        <View
          nativeID={handDetection.previewContainerId}
          style={styles.cameraPreview}
          {...(Platform.OS === 'web' && {
            'data-native-id': handDetection.previewContainerId,
            'data-hand-preview-container': 'true',
          })}
        />

        {/* Game Overlay */}
        <View
          style={styles.gameOverlay}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setGameRect({ width, height });
          }}
          {...(Platform.OS === 'web' && { 'data-game-area': 'true' })}
        >
          <Svg
            style={StyleSheet.absoluteFill}
            width={gameRect.width}
            height={gameRect.height}
          >
            {/* Road Path */}
            {pathString && (
              <>
                {/* Road shadow */}
              <Path
                  d={pathString}
                  stroke="#1F2937"
                  strokeWidth={ROAD_WIDTH + 4}
                fill="none"
                strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.3}
              />
                {/* Main road */}
            <Path
                  d={pathString}
              stroke="#374151"
              strokeWidth={ROAD_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Road center line */}
            <Path
                  d={pathString}
              stroke="#FCD34D"
                  strokeWidth={4}
                  strokeDasharray="15, 10"
              fill="none"
            />
                {/* Road edges */}
                <Path
                  d={pathString}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                />
              </>
            )}

            {/* Coverage Indicator */}
            {coverage > 0 && pathString && (
              <Path
                d={pathString}
                stroke="#22C55E"
                strokeWidth={ROAD_WIDTH + 5}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${coverage * 1000} 1000`}
                opacity={0.5}
              />
            )}

            {/* Calibration Box */}
            {gameState === 'calibration' && (
              <Circle
                cx={gameRect.width / 2}
                cy={gameRect.height / 2}
                r={50}
                fill="none"
                stroke="#3B82F6"
                strokeWidth={4}
                strokeDasharray="10,5"
                opacity={0.8}
              />
            )}

            {/* Countdown */}
            {gameState === 'countdown' && countdown > 0 && (
              <Circle
                cx={gameRect.width / 2}
                cy={gameRect.height / 2}
                r={80}
                fill="rgba(59, 130, 246, 0.2)"
                stroke="#3B82F6"
                strokeWidth={6}
              />
            )}

            {/* Index Finger Cursor - Glowing Dot */}
            {carPosition && gameState === 'playing' && (
              <>
                {/* Outer glow */}
                <Circle
                  cx={carPosition.x}
                  cy={carPosition.y}
                  r={25}
                  fill="#60A5FA"
                  opacity={0.3}
                />
                {/* Inner dot */}
                <Circle
                  cx={carPosition.x}
                  cy={carPosition.y}
                  r={15}
                  fill="#3B82F6"
                  stroke="#FFFFFF"
                  strokeWidth={3}
                />
              </>
            )}
          </Svg>

          {/* Car */}
          {carPosition && gameState === 'playing' && (
            <View
            style={[
              styles.carContainer,
              {
                  left: carPosition.x - CAR_SIZE / 2,
                  top: carPosition.y - CAR_SIZE / 2,
                  transform: [{ rotate: `${carRotation}deg` }],
              },
            ]}
          >
              <Text style={[styles.carEmoji, { color: isOnRoad ? '#22C55E' : '#EF4444' }]}>🚗</Text>
        </View>
          )}

          {/* Countdown Text */}
          {gameState === 'countdown' && countdown > 0 && (
            <View style={styles.countdownContainer}>
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          )}

          {/* Calibration Instruction */}
          {gameState === 'calibration' && (
            <View style={styles.calibrationContainer}>
              <Text style={styles.calibrationText}>
                👆 Show your index finger in the center box
          </Text>
        </View>
          )}
        </View>
      </View>

      {/* Bottom Info Bar */}
      <View style={styles.infoBar}>
        {gameState === 'playing' && (
          <>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Coverage</Text>
              <Text style={styles.infoValue}>{Math.round(coverage * 100)}%</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Target</Text>
              <Text style={styles.infoValue}>{Math.round(COVERAGE_TARGET * 100)}%</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={[styles.infoValue, isOnRoad ? styles.onRoadText : styles.offRoadText]}>
                {isOnRoad ? '✅ On Road' : '⚠️ Off Road'}
              </Text>
            </View>
            {offRoadPenalty > 0 && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Off Road</Text>
                <Text style={[styles.infoValue, styles.penaltyText]}>{offRoadPenalty}</Text>
              </View>
            )}
          </>
        )}
        {gameState === 'roundComplete' && !showRoundSuccess && roundResults.length > 0 && (
          <View style={styles.roundResultContainer}>
            <Text style={styles.roundResultText}>
              Round {roundResults[roundResults.length - 1].round} Complete!
            </Text>
            <Text style={styles.roundResultStars}>
              {Array.from({ length: roundResults[roundResults.length - 1].stars }).map(() => '⭐').join('')}
            </Text>
            <Text style={styles.roundResultCoverage}>
              Coverage: {Math.round(roundResults[roundResults.length - 1].coverage * 100)}%
            </Text>
          </View>
        )}
      </View>

      {/* Error Message */}
      {handDetection.error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{handDetection.error}</Text>
        </View>
      )}

      {/* No Hand Detected Message */}
      {gameState === 'playing' && !handDetection.landmarks?.indexFingerTip && (
        <View style={styles.noHandContainer}>
          <Text style={styles.noHandText}>👋 Show your hand!</Text>
        </View>
      )}

      {/* Round Success Animation - Outside all containers to overlay properly */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={roundResults[roundResults.length - 1]?.stars}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#87CEEB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#E0E7FF',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  roundText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FEF3C7',
    borderRadius: 20,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  gameContainer: {
    flex: 1,
    position: 'relative',
  },
  cameraPreview: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  gameOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  countdownContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#3B82F6',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  calibrationContainer: {
    position: 'absolute',
    top: '45%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  calibrationText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3B82F6',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    textAlign: 'center',
  },
  carContainer: {
    position: 'absolute',
    width: CAR_SIZE,
    height: CAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  carEmoji: {
    fontSize: CAR_SIZE,
  },
  infoBar: {
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#E0E7FF',
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
  },
  infoItem: {
    alignItems: 'center',
    marginBottom: 8,
    minWidth: 80,
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 4,
  },
  onRoadText: {
    color: '#22C55E',
  },
  offRoadText: {
    color: '#EF4444',
  },
  penaltyText: {
    color: '#EF4444',
  },
  roundResultContainer: {
    alignItems: 'center',
    width: '100%',
  },
  roundResultText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  roundResultStars: {
    fontSize: 24,
    marginBottom: 4,
  },
  roundResultCoverage: {
    fontSize: 14,
    color: '#64748B',
  },
  errorContainer: {
    padding: 16,
    backgroundColor: '#FFEBEE',
    borderTopWidth: 1,
    borderTopColor: '#FFCDD2',
  },
  errorText: {
    color: '#C62828',
    textAlign: 'center',
    fontSize: 14,
  },
  noHandContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  noHandText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F59E0B',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
});

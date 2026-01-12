/**
 * Paint Curved Snake Game
 * A hand-tracking game where kids paint snake curves with their index finger
 * Features: 5 difficulty rounds, timer, coverage tracking, star scoring, color picker, and beautiful UI
 */

import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useHandDetectionWeb } from '@/hooks/useHandDetectionWeb';
import { logGameAndAward } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import Svg, { Circle, Path } from 'react-native-svg';
import { SparkleBurst } from '@/components/game/FX';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

interface Point {
  x: number;
  y: number;
}

interface RoundResult {
  round: number;
  coverage: number;
  stars: number;
  offPathPenalty: number;
  timeRemaining: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const COVERAGE_TARGET = 0.70; // 70% coverage needed
const PATH_TOLERANCE = 50; // pixels (will vary by round)
const DEFAULT_TTS_RATE = 0.75;

const COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'];

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

// Calculate distance from point to nearest path segment
function distanceToPath(point: Point, path: Point[]): number {
  let minDist = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
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

  playSuccess() {
    this.playTone(523.25, 0.2, 'sine'); // C5
    setTimeout(() => this.playTone(659.25, 0.2, 'sine'), 100); // E5
    setTimeout(() => this.playTone(783.99, 0.3, 'sine'), 200); // G5
  }

  playStartChime() {
    this.playTone(440, 0.15, 'sine'); // A4
    setTimeout(() => this.playTone(554.37, 0.2, 'sine'), 150); // C#5
  }

  playCountdown() {
    this.playTone(440, 0.1, 'square'); // A4
  }
}

// Generate different snake paths based on round difficulty
function generateSnakePath(width: number, height: number, round: number): Point[] {
  const centerX = width / 2;
  const centerY = height * 0.5;
  // Increase curve intensity from 0.3 to 0.7
  const curveIntensity = 0.3 + (round - 1) * 0.1;

    // Generate wavy snake path
    const path: Point[] = [];
  const startX = width * 0.1;
  const endX = width * 0.9;
    const segments = 100;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = startX + (endX - startX) * t;
    const y = centerY + Math.sin(t * Math.PI * 4) * height * 0.15 * curveIntensity;
      path.push({ x, y });
    }
    return path;
}

export function PaintCurvedSnakeGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const handDetection = useHandDetectionWeb(true);
  const isTablet = screenWidth >= 768;
  const isMobile = screenWidth < 600;

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [gameRect, setGameRect] = useState({ width: 0, height: 0 });
  const [currentRound, setCurrentRound] = useState(1);
  const [snakePath, setSnakePath] = useState<Point[]>([]);
  const [paintedPath, setPaintedPath] = useState<Point[]>([]);
  const [indexFingerPos, setIndexFingerPos] = useState<Point | null>(null);
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
  const [offPathPenalty, setOffPathPenalty] = useState(0);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [sparkleVisible, setSparkleVisible] = useState(false);
  const [isOnPath, setIsOnPath] = useState(true);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Refs
  const smoother = useRef(new KalmanSmoother());
  const coveredSegments = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundEffects = useRef(new SoundEffects());
  const confettiAnimation = useRef(new Animated.Value(0)).current;
  const lastProgressAnnouncement = useRef(0);
  const finishGameRef = useRef<(() => void) | undefined>(undefined);
  const lastHandWarning = useRef(0);

  // Initialize sound effects
  useEffect(() => {
    soundEffects.current.init();
  }, []);

  // Generate snake path when game area is ready or round changes
  useEffect(() => {
    if (gameRect.width > 0 && gameRect.height > 0 && currentRound <= requiredRounds) {
      const path = generateSnakePath(gameRect.width, gameRect.height, currentRound);
      setSnakePath(path);
      smoother.current.reset();
      setCoverage(0);
      setOffPathPenalty(0);
    setPaintedPath([]);
      coveredSegments.current.clear();
      lastProgressAnnouncement.current = 0;
    }
  }, [gameRect.width, gameRect.height, currentRound, requiredRounds]);

  // Update coverage when finger moves - segment-based approach
  const updateCoverage = useCallback((point: Point) => {
    if (!snakePath.length) return;

    // Get tolerance based on round (decreases with difficulty)
    const tolerance = Math.max(30, PATH_TOLERANCE - (currentRound - 1) * 5);
    let newSegmentsCovered = 0;

      for (let i = 0; i < snakePath.length; i++) {
      if (coveredSegments.current.has(i)) continue; // Already covered
      
      const pathPoint = snakePath[i];
      const dist = Math.hypot(point.x - pathPoint.x, point.y - pathPoint.y);
      
      if (dist < tolerance) {
        coveredSegments.current.add(i);
        newSegmentsCovered++;
      }
    }

    // Update coverage based on segments covered
    const newCoverage = snakePath.length > 0 
      ? coveredSegments.current.size / snakePath.length 
      : 0;
    
    if (newCoverage > coverage) {
      setCoverage(newCoverage);
    }

    // Check if on path for visual feedback
    const distToPath = distanceToPath(point, snakePath);
    const onPath = distToPath < tolerance;
    setIsOnPath(onPath);

    // Add to painted path if on path
    if (onPath) {
      setPaintedPath(prev => {
        // Avoid adding duplicate points too close together
        if (prev.length > 0) {
          const lastPoint = prev[prev.length - 1];
          const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
          if (dist < 5) return prev; // Too close, skip
        }
        return [...prev, point];
      });
    }

    // Calculate off-path penalty
    if (distToPath > tolerance * 2) {
      setOffPathPenalty(prev => prev + 1);
    }
  }, [snakePath, coverage, currentRound]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    if (currentRound === 1) {
      speak(
        'Welcome to Paint the Snake! Point your index finger at the snake path and paint it by tracing along the curve. ' +
        'Cover at least 70 percent of the path to complete each round. ' +
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
        instruction = 'Round 1! This is a gentle wavy curve. Paint it carefully from left to right.';
        break;
      case 2:
        instruction = 'Round 2! This is a medium wavy curve. Follow the snake path smoothly.';
        break;
      case 3:
        instruction = 'Round 3! This is a deeper wavy curve. Trace all the curves carefully.';
        break;
      case 4:
        instruction = 'Round 4! This is a very deep wavy curve. Follow the winding path.';
        break;
      case 5:
        instruction = 'Round 5! Final round - deepest curve with tight tolerance. Take your time!';
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
          speak('Go! Paint the snake now! You have 20 seconds!');
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

  // Timer management
  useEffect(() => {
    if (gameState !== 'playing') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 0) {
          endRound();
          return 0;
        }

        // Voice warnings
        if (prev === 10000) {
          speak('10 seconds remaining!');
        } else if (prev === 5000) {
          speak('5 seconds left!');
        }

        return prev - 100;
      });
    }, 100) as unknown as ReturnType<typeof setInterval>;

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [gameState]);

  // End round
  const endRound = useCallback(() => {
    setGameState(prevState => {
      if (prevState !== 'playing') return prevState;
      
      setGameState('roundComplete');

      // Calculate stars (1-3)
      let stars = 0;
      if (coverage >= COVERAGE_TARGET) {
        if (coverage >= 0.9 && offPathPenalty < 10) {
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
        offPathPenalty,
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
        
        if (prevRound < requiredRounds) {
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
  }, [coverage, offPathPenalty, timeRemaining, currentRound, startCalibration, requiredRounds]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');

    const averageCoverage = roundResults.reduce((sum, r) => sum + r.coverage, 0) / roundResults.length;
    const accuracy = Math.round(averageCoverage * 100);

    const stats = {
      totalRounds: requiredRounds,
      averageCoverage,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    
    // Show congratulations screen first
    setShowCongratulations(true);

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
    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'paint-curved-snake',
        correct: totalStars,
        total: requiredRounds * 3, // Max possible stars
        accuracy,
        xpAwarded,
        skillTags: ['hand-tracking', 'fine-motor', 'visual-motor', 'attention', 'path-completion'],
        meta: {
          totalRounds: requiredRounds,
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
  }, [roundResults, totalStars, onComplete, confettiAnimation, requiredRounds]);

  // Update ref when finishGame changes
  useEffect(() => {
    finishGameRef.current = finishGame;
  }, [finishGame]);

  // Track hand detection and provide feedback
  useEffect(() => {
    if (gameState === 'playing' && !handDetection.landmarks?.indexFingerTip) {
      const now = Date.now();
      if (now - lastHandWarning.current > 3000) {
        lastHandWarning.current = now;
        speak('Show your index finger to paint!');
      }
    }
  }, [gameState, handDetection.landmarks]);

  // Track index finger and update coverage
  useEffect(() => {
    if (
      gameState !== 'playing' ||
      !handDetection.landmarks?.indexFingerTip ||
      !snakePath.length
    ) {
      setIndexFingerPos(null);
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
        setIndexFingerPos(null);
        return;
      }

      // Smooth the position
      const smoothed = smoother.current.update(screenCoords.x, screenCoords.y);
      setIndexFingerPos(smoothed);

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
      if (
        (coveragePercent >= 25 && lastProgressAnnouncement.current < 25) ||
        (coveragePercent >= 50 && lastProgressAnnouncement.current < 50) ||
        (coveragePercent >= 75 && lastProgressAnnouncement.current < 75)
      ) {
        lastProgressAnnouncement.current = coveragePercent;
        speak(`Great progress! You've painted ${coveragePercent} percent!`);
      }
    };

    updatePosition();
    const interval = setInterval(updatePosition, 16); // ~60fps
    return () => clearInterval(interval);
  }, [gameState, handDetection.landmarks, snakePath, coverage, timeRemaining, updateCoverage, endRound]);

  // Initialize calibration on mount
  useEffect(() => {
    startCalibration();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Convert paths to SVG strings
  const pathToSvgString = useCallback((path: Point[]): string => {
    if (path.length === 0) return '';
    let d = `M ${path[0].x} ${path[0].y}`;
    for (let i = 1; i < path.length; i++) {
      d += ` L ${path[i].x} ${path[i].y}`;
    }
    return d;
  }, []);

  const snakeString = pathToSvgString(snakePath);
  const paintedString = pathToSvgString(paintedPath);
  const glowSize = isTablet ? 50 : isMobile ? 35 : 40;

  // Show congratulations screen with stats
  if (gameState === 'gameComplete' && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.totalStars}
        total={requiredRounds * 3}
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
      {/* Green gradient background */}
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0', '#86EFAC']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Header */}
        <View style={[styles.header, isMobile && styles.headerMobile]}>
          <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        <View style={styles.headerCenter}>
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Paint the Snake</Text>
          {gameState !== 'gameComplete' && (
            <Text style={[styles.roundText, isMobile && styles.roundTextMobile]}>
              Round {currentRound}/{requiredRounds}
            </Text>
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

        {/* Color Picker */}
        <View style={[styles.colorPicker, isMobile && styles.colorPickerMobile]}>
          {COLORS.map((color, index) => (
            <Pressable
              key={index}
              onPress={() => setSelectedColor(color)}
              style={[
                styles.colorButton,
                {
                  backgroundColor: color,
                  borderWidth: selectedColor === color ? 3 : 1,
                  borderColor: selectedColor === color ? '#0F172A' : '#CBD5E1',
                },
              ]}
            />
          ))}
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
            {/* Snake outline */}
            {snakeString && (
            <Path
              d={snakeString}
              stroke="#64748B"
              strokeWidth={35}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
                opacity={0.9}
            />
            )}

            {/* Painted path (fills as finger traces) */}
            {paintedString && paintedPath.length > 1 && (
              <Path
                d={paintedString}
                stroke={selectedColor}
                strokeWidth={30}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
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
            {indexFingerPos && gameState === 'playing' && (
              <>
                {/* Outer glow */}
                <Circle
                  cx={indexFingerPos.x}
                  cy={indexFingerPos.y}
                  r={glowSize}
                  fill={isOnPath ? selectedColor : '#EF4444'}
                  opacity={0.3}
                />
                {/* Inner dot */}
                <Circle
                  cx={indexFingerPos.x}
                  cy={indexFingerPos.y}
                  r={glowSize / 2}
                  fill={isOnPath ? selectedColor : '#EF4444'}
                  stroke="#FFFFFF"
                  strokeWidth={3}
                />
              </>
            )}
          </Svg>

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

          {/* Progress Bar */}
          {gameState === 'playing' && (
          <View style={[styles.progressContainer, isMobile && styles.progressContainerMobile]}>
            <View style={styles.progressBarBackground}>
                <View
                style={[
                  styles.progressBarFill,
                  {
                      width: `${coverage * 100}%`,
                    backgroundColor: selectedColor,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isMobile && styles.progressTextMobile]}>
                {Math.round(coverage * 100)}% Painted
            </Text>
          </View>
          )}

          {/* Status Indicator */}
          {gameState === 'playing' && (
            <View style={styles.statusContainer}>
              <Text style={[styles.statusText, isOnPath && styles.statusTextOnPath]}>
                {isOnPath ? '✓ On Path' : '✗ Off Path'}
              </Text>
            </View>
          )}

          <SparkleBurst visible={sparkleVisible} color={selectedColor} count={15} size={8} />
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
            {offPathPenalty > 0 && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Off Path</Text>
                <Text style={[styles.infoValue, styles.penaltyText]}>{offPathPenalty}</Text>
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
    backgroundColor: '#F0FDF4',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(240, 253, 244, 0.95)',
  },
  headerMobile: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  titleMobile: {
    fontSize: 20,
  },
  roundText: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  roundTextMobile: {
    fontSize: 12,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  colorPicker: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  colorPickerMobile: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  colorButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  gameContainer: {
    flex: 1,
    position: 'relative',
  },
  cameraPreview: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  gameOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  progressContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 10,
  },
  progressContainerMobile: {
    top: 10,
    left: 10,
    right: 10,
  },
  progressBarBackground: {
    width: '100%',
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  progressTextMobile: {
    fontSize: 12,
  },
  statusContainer: {
    position: 'absolute',
    top: 80,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 10,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  statusTextOnPath: {
    color: '#10B981',
  },
  countdownContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -50 }, { translateY: -50 }],
    zIndex: 20,
  },
  countdownText: {
    fontSize: 80,
    fontWeight: 'bold',
    color: '#3B82F6',
    textAlign: 'center',
  },
  calibrationContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -150 }, { translateY: 100 }],
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 16,
    borderRadius: 16,
    zIndex: 20,
  },
  calibrationText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
  },
  infoBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    gap: 20,
  },
  infoItem: {
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  penaltyText: {
    color: '#EF4444',
  },
  roundResultContainer: {
    alignItems: 'center',
  },
  roundResultText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 4,
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
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 12,
    zIndex: 30,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
  },
  noHandContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 16,
    borderRadius: 16,
    zIndex: 20,
  },
  noHandText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
  },
});

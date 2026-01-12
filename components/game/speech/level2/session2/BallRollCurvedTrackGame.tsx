/**
 * Ball Roll on Curved Track Game
 * A hand-tracking game where kids roll a ball along a curved track using their index finger
 * Features: 5 difficulty levels, timer, coverage tracking, scoring, and beautiful UI
 */

import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useHandDetectionWeb } from '@/hooks/useHandDetectionWeb';
import { logGameAndAward } from '@/utils/api';
import { snapToPath, generateCurvePath, Point } from '@/utils/pathUtils';
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

type Props = {
  onBack: () => void;
  onComplete?: () => void;
};

interface RoundResult {
  round: number;
  coverage: number;
  stars: number;
  offTrackPenalty: number;
  timeRemaining: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const COVERAGE_TARGET = 0.70; // 70% coverage needed
const TRACK_TOLERANCE = 60; // pixels
const SNAP_DISTANCE = 80; // How far ball can snap to track
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

// Generate different curved track paths based on round difficulty
function generateTrackPath(width: number, height: number, round: number): { path: Point[]; starPos: Point } {
  const startX = width * 0.15;
  const endX = width * 0.85;
  const centerY = height * 0.5;
  const curveIntensity = 0.3 + (round - 1) * 0.1; // 0.3 to 0.7

    const start: Point = { x: startX, y: centerY };
    const end: Point = { x: endX, y: centerY };
    const control: Point = {
    x: width * 0.5,
    y: centerY - height * 0.25 * curveIntensity,
    };

  const path = generateCurvePath(start, end, control, 100 + (round * 20));
    return { path, starPos: end };
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
}

export function BallRollCurvedTrackGame({ onBack, onComplete }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const handDetection = useHandDetectionWeb(true);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [gameRect, setGameRect] = useState({ width: 0, height: 0 });
  const [currentRound, setCurrentRound] = useState(1);
  const [trackPath, setTrackPath] = useState<Point[]>([]);
  const [starPosition, setStarPosition] = useState<Point>({ x: 0, y: 0 });
  const [ballPosition, setBallPosition] = useState<Point | null>(null);
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
  const [offTrackPenalty, setOffTrackPenalty] = useState(0);
  const [isOnTrack, setIsOnTrack] = useState(true);

  // Refs
  const smoother = useRef(new KalmanSmoother());
  const coveredSegments = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundEffects = useRef(new SoundEffects());
  const confettiAnimation = useRef(new Animated.Value(0)).current;
  const lastProgressAnnouncement = useRef(0);
  const finishGameRef = useRef<(() => void) | undefined>(undefined);
  const starScale = useRef(new Animated.Value(1)).current;
  const starOpacity = useRef(new Animated.Value(1)).current;
  const [hasWarned10, setHasWarned10] = useState(false);
  const [hasWarned5, setHasWarned5] = useState(false);
  const [lastHandWarning, setLastHandWarning] = useState(0);

  // Initialize sound effects
  useEffect(() => {
    soundEffects.current.init();
  }, []);

  // Generate track path when game area is ready or round changes
  useEffect(() => {
    if (gameRect.width > 0 && gameRect.height > 0 && currentRound <= TOTAL_ROUNDS) {
      const { path, starPos } = generateTrackPath(gameRect.width, gameRect.height, currentRound);
      setTrackPath(path);
      setStarPosition(starPos);
      smoother.current.reset();
      setCoverage(0);
      setOffTrackPenalty(0);
      coveredSegments.current.clear();
      lastProgressAnnouncement.current = 0;
      
      // Set ball to start position
      if (path.length > 0) {
        setBallPosition(path[0]);
      }
    }
  }, [gameRect.width, gameRect.height, currentRound]);

  // Update coverage when ball moves
  const updateCoverage = useCallback((point: Point) => {
    if (!trackPath.length) return;

    // Check which track segments are near the ball
    const tolerance = TRACK_TOLERANCE;
    let newSegmentsCovered = 0;

    for (let i = 0; i < trackPath.length; i++) {
      if (coveredSegments.current.has(i)) continue; // Already covered
      
      const trackPoint = trackPath[i];
      const dist = Math.hypot(point.x - trackPoint.x, point.y - trackPoint.y);
      
      if (dist < tolerance) {
        coveredSegments.current.add(i);
        newSegmentsCovered++;
      }
    }

    // Update coverage based on segments covered
    const newCoverage = trackPath.length > 0 
      ? coveredSegments.current.size / trackPath.length 
      : 0;
    
    if (newCoverage > coverage) {
      setCoverage(newCoverage);
    }

    // Check if on track
    const distToTrack = distanceToPath(point, trackPath);
    const onTrack = distToTrack < TRACK_TOLERANCE;
    setIsOnTrack(onTrack);

    // Calculate off-track penalty
    if (distToTrack > TRACK_TOLERANCE * 2) {
      setOffTrackPenalty(prev => prev + 1);
    }
  }, [trackPath, coverage]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    if (currentRound === 1) {
      speak(
        'Welcome to Ball Roll on Curved Track! Use your index finger to roll the ball along the curved track to reach the star. ' +
        'Cover at least 70 percent of the track or reach the star to complete each round. ' +
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
        instruction = 'Round 1! Roll the ball along the gentle curve to reach the star.';
        break;
      case 2:
        instruction = 'Round 2! This track has more curves. Follow the path carefully.';
        break;
      case 3:
        instruction = 'Round 3! Deeper curves ahead. Roll the ball smoothly along the track.';
        break;
      case 4:
        instruction = 'Round 4! Very curved track coming up. Stay on the path.';
        break;
      case 5:
        instruction = 'Round 5! Final round - most challenging curve. Take your time and roll carefully!';
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
          speak('Go! Roll the ball to the star now! You have 20 seconds!');
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
            speak('10 seconds remaining! Keep rolling!');
          }
          if (prev <= 6000 && prev > 5000 && !hasWarned5) {
            setHasWarned5(true);
            speak('5 seconds left! Roll faster!');
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
        if (coverage >= 0.9 && offTrackPenalty < 10) {
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
        offTrackPenalty,
        timeRemaining,
      };

      setRoundResults(prev => [...prev, result]);
      setTotalStars(prev => prev + stars);

    // Star animation
    Animated.sequence([
      Animated.parallel([
        Animated.spring(starScale, {
          toValue: 1.5,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(starOpacity, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(starScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(starOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

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
  }, [coverage, offTrackPenalty, timeRemaining, currentRound, startCalibration]);

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
        type: 'ball-roll-curved-track',
        correct: totalStars,
        total: TOTAL_ROUNDS * 3, // Max possible stars
        accuracy,
        xpAwarded,
        skillTags: ['hand-tracking', 'fine-motor', 'visual-motor', 'attention', 'bilateral-coordination'],
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
        speak('Show your index finger to roll the ball!');
      }
    }
  }, [gameState, handDetection.landmarks, lastHandWarning]);

  // Track index finger and update ball position
  useEffect(() => {
    if (
      gameState !== 'playing' ||
      !handDetection.landmarks?.indexFingerTip ||
      !trackPath.length
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

      // Snap ball to nearest point on track
      const snapped = snapToPath(smoothed, trackPath, SNAP_DISTANCE);
      setBallPosition(snapped);

      // Update coverage
      updateCoverage(snapped);

      // Check if ball reached star
      const dx = snapped.x - starPosition.x;
      const dy = snapped.y - starPosition.y;
      const distToStar = Math.sqrt(dx * dx + dy * dy);
      
      if (distToStar < 50 && timeRemaining > 0) {
        speak('Great job! You reached the star!');
        setTimeout(() => {
          endRound();
        }, 1000);
      }

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
  }, [gameState, handDetection.landmarks, trackPath, coverage, timeRemaining, starPosition, updateCoverage, endRound]);

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
  const pathString = trackPath.length > 0
    ? `M ${trackPath[0].x} ${trackPath[0].y} ` +
    trackPath.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
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
        colors={['#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Header */}
      <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Ball Roll on Track</Text>
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
            {/* Track Path */}
            {pathString && (
              <>
                {/* Track shadow */}
            <Path
                  d={pathString}
                  stroke="#475569"
                  strokeWidth={24}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.3}
                />
                {/* Main track */}
                <Path
                  d={pathString}
              stroke="#64748B"
              strokeWidth={20}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
              </>
            )}

            {/* Coverage Indicator */}
            {coverage > 0 && pathString && (
              <Path
                d={pathString}
                stroke="#22C55E"
                strokeWidth={24}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${coverage * 1000} 1000`}
                opacity={0.6}
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
                  r={25}
                  fill={isOnTrack ? "#22C55E" : "#EF4444"}
                  opacity={0.3}
                />
                {/* Inner dot */}
                <Circle
                  cx={indexFingerPos.x}
                  cy={indexFingerPos.y}
                  r={15}
                  fill={isOnTrack ? "#22C55E" : "#EF4444"}
                  stroke="#FFFFFF"
                  strokeWidth={3}
                />
              </>
            )}
          </Svg>

          {/* Star Target */}
          {starPosition.x > 0 && starPosition.y > 0 && (
          <Animated.View
            style={[
              styles.starContainer,
              {
                  left: starPosition.x - 30,
                  top: starPosition.y - 30,
                transform: [{ scale: starScale }],
                opacity: starOpacity,
              },
            ]}
          >
              <Text style={styles.starEmoji}>⭐</Text>
          </Animated.View>
          )}

          {/* Ball */}
          {ballPosition && gameState === 'playing' && (
            <View
            style={[
              styles.ballContainer,
              {
                  left: ballPosition.x - 25,
                  top: ballPosition.y - 25,
              },
            ]}
          >
              <Text style={styles.ballEmoji}>⚽</Text>
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
              <Text style={[styles.infoValue, isOnTrack ? styles.onTrackText : styles.offTrackText]}>
                {isOnTrack ? '✅ On Track' : '⚠️ Off Track'}
              </Text>
            </View>
            {offTrackPenalty > 0 && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Off Track</Text>
                <Text style={[styles.infoValue, styles.penaltyText]}>{offTrackPenalty}</Text>
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
    backgroundColor: '#F0F9FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#BAE6FD',
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
    backgroundColor: '#F0F9FF',
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
  ballContainer: {
    position: 'absolute',
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  ballEmoji: {
    fontSize: 50,
  },
  starContainer: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
  },
  starEmoji: {
    fontSize: 60,
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
  infoBar: {
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#BAE6FD',
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
  onTrackText: {
    color: '#22C55E',
  },
  offTrackText: {
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

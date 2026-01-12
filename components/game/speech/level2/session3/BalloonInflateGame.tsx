/**
 * Balloon Inflate Game
 * Each blow adds air, balloon inflates fully
 */

import BlowMeter from '@/components/game/BlowMeter';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { BlowDetector } from '@/utils/blowDetection';
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
import Svg, { Defs, Ellipse, LinearGradient as SvgLinearGradient, RadialGradient, Path, Stop } from 'react-native-svg';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

interface RoundResult {
  round: number;
  stars: number;
  inflationPercent: number; // Percentage of max size
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 25000; // 25 seconds per round
const MAX_BALLOON_WIDTH = 250;
const MAX_BALLOON_HEIGHT = 300;
const MIN_BALLOON_WIDTH = 80;
const MIN_BALLOON_HEIGHT = 100;
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

export function BalloonInflateGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const isMobile = screenWidth < 600;
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties (type assertion needed)
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [balloonWidth, setBalloonWidth] = useState(MIN_BALLOON_WIDTH);
  const [balloonHeight, setBalloonHeight] = useState(MIN_BALLOON_HEIGHT);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    averageInflation: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const blowDetector = useRef(new BlowDetector(800, 0.4));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const balloonWidthAnim = useRef(new Animated.Value(MIN_BALLOON_WIDTH)).current;
  const balloonHeightAnim = useRef(new Animated.Value(MIN_BALLOON_HEIGHT)).current;
  const lastBlowEnd = useRef<number>(0);

  // Update balloon size based on blow
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const protrusionValue = (protrusion as number) || 0;
    const blowState = blowDetector.current.update(isOpen || false, protrusionValue, ratio || 0);

    if (blowState.isSustained) {
      // Inflate balloon based on blow intensity
      const inflationRate = blowState.intensity * 3; // pixels per frame
      setBalloonWidth(prev => Math.min(MAX_BALLOON_WIDTH, prev + inflationRate));
      setBalloonHeight(prev => Math.min(MAX_BALLOON_HEIGHT, prev + inflationRate * 1.2));
      lastBlowEnd.current = Date.now();
    } else if (Date.now() - lastBlowEnd.current > 500) {
      // Slight deflation when not blowing (realistic physics)
      setBalloonWidth(prev => Math.max(MIN_BALLOON_WIDTH, prev - 0.5));
      setBalloonHeight(prev => Math.max(MIN_BALLOON_HEIGHT, prev - 0.6));
    }
  }, [isOpen, protrusion, ratio, isDetecting, gameState]);

  // Animate balloon size
  useEffect(() => {
    Animated.parallel([
      Animated.timing(balloonWidthAnim, {
        toValue: balloonWidth,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(balloonHeightAnim, {
        toValue: balloonHeight,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [balloonWidth, balloonHeight]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    blowDetector.current.reset();
    setBalloonWidth(MIN_BALLOON_WIDTH);
    setBalloonHeight(MIN_BALLOON_HEIGHT);
    setTimeElapsed(0);
    lastBlowEnd.current = 0;
    balloonWidthAnim.setValue(MIN_BALLOON_WIDTH);
    balloonHeightAnim.setValue(MIN_BALLOON_HEIGHT);

    if (currentRound === 1) {
      speak(
        'Welcome to Balloon Inflate! Blow into your device to inflate the balloon. ' +
        'Keep blowing until the balloon is fully inflated! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    speak('Get ready!');

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          startRound();
          return 0;
        }
        speak(prev - 1 === 0 ? 'Go! Inflate the balloon!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setBalloonWidth(MIN_BALLOON_WIDTH);
    setBalloonHeight(MIN_BALLOON_HEIGHT);
    setTimeElapsed(0);
    lastBlowEnd.current = 0;
    balloonWidthAnim.setValue(MIN_BALLOON_WIDTH);
    balloonHeightAnim.setValue(MIN_BALLOON_HEIGHT);
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      // Timeout after 25 seconds
      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, []);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const widthPercent = ((balloonWidth - MIN_BALLOON_WIDTH) / (MAX_BALLOON_WIDTH - MIN_BALLOON_WIDTH)) * 100;
    const heightPercent = ((balloonHeight - MIN_BALLOON_HEIGHT) / (MAX_BALLOON_HEIGHT - MIN_BALLOON_HEIGHT)) * 100;
    const inflationPercent = (widthPercent + heightPercent) / 2;
    let stars = 0;

    if (inflationPercent >= 100 && timeElapsed < 12) {
      stars = 3;
    } else if (inflationPercent >= 100 && timeElapsed < 25) {
      stars = 2;
    } else if (inflationPercent >= 70) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      inflationPercent,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setGameState('roundComplete');

    // Wait for animation to complete before moving to next round
    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        startCalibration();
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, balloonWidth, balloonHeight, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const averageInflation = roundResults.reduce((sum, r) => sum + r.inflationPercent, 0) / roundResults.length;
    const accuracy = Math.round(averageInflation);

    const stats = {
      totalRounds: requiredRounds,
      averageInflation,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    setShowCongratulations(true);

    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'balloon-inflate',
        correct: totalStars,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['airflow', 'oral-motor', 'breath-control', 'coordination'],
        meta: {
          totalRounds: requiredRounds,
          averageInflation,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, onComplete, requiredRounds]);

  // Check for face detection to start countdown
  useEffect(() => {
    if (gameState === 'calibration' && isDetecting && hasCamera) {
      setTimeout(() => {
        startCountdown();
      }, 1000);
    }
  }, [gameState, isDetecting, hasCamera, startCountdown]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearScheduledSpeech();
    };
  }, []);

  // Initialize
  useEffect(() => {
    startCalibration();
  }, [startCalibration]);

  const blowState = blowDetector.current.update(
    isOpen || false,
    (protrusion as number) || 0,
    ratio || 0
  );

  // Show congratulations screen with stats
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Balloon Champion!"
        showButtons={true}
        correct={finalStats.totalStars}
        total={requiredRounds * 3}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const balloonColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181'];
  const currentColor = balloonColors[(currentRound - 1) % balloonColors.length];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FFB6C1', '#FFC0CB', '#FFD1DC', '#FFE4E1']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Camera Preview */}
      {Platform.OS === 'web' && previewContainerId && (
        <View
          nativeID={previewContainerId}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Game Overlay */}
      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.roundText}>Round {currentRound} of {requiredRounds}</Text>
            <View style={styles.starsContainer}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={20}
                  color={i < Math.floor(totalStars / currentRound) ? '#FFD700' : '#FFF'}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Blow Meter */}
        {gameState === 'playing' && (
          <View style={styles.meterContainer}>
            <BlowMeter intensity={blowState.intensity} isBlowing={blowState.isBlowing} />
          </View>
        )}

        {/* Calibration */}
        {gameState === 'calibration' && (
          <View style={styles.calibrationContainer}>
            <View style={styles.calibrationBox}>
              <Ionicons name="camera" size={48} color="#FFF" />
              <Text style={styles.calibrationText}>
                {isDetecting ? 'Face detected! Starting soon...' : 'Show your face to the camera'}
              </Text>
            </View>
          </View>
        )}

        {/* Countdown */}
        {gameState === 'countdown' && (
          <View style={styles.countdownContainer}>
            <Animated.Text
              style={[
                styles.countdownText,
                {
                  transform: [{ scale: countdown > 0 ? 1.5 : 1 }],
                },
              ]}
            >
              {countdown > 0 ? countdown : 'GO!'}
            </Animated.Text>
          </View>
        )}

        {/* Game */}
        {gameState === 'playing' && (
          <View style={styles.gameContainer}>
            <View style={styles.balloonContainer}>
              <Animated.View
                style={{
                  width: balloonWidthAnim,
                  height: balloonHeightAnim,
                }}
              >
                <Svg width={MAX_BALLOON_WIDTH} height={MAX_BALLOON_HEIGHT} viewBox={`0 0 ${MAX_BALLOON_WIDTH} ${MAX_BALLOON_HEIGHT}`}>
                  <Defs>
                    <SvgLinearGradient id="balloonGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <Stop offset="0%" stopColor={currentColor} stopOpacity="0.9" />
                      <Stop offset="100%" stopColor={currentColor} stopOpacity="0.6" />
                    </SvgLinearGradient>
                    <RadialGradient id="balloonHighlight" cx="30%" cy="30%" r="40%">
                      <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
                      <Stop offset="100%" stopColor={currentColor} stopOpacity="0" />
                    </RadialGradient>
                  </Defs>
                  <Ellipse
                    cx={MAX_BALLOON_WIDTH / 2}
                    cy={MAX_BALLOON_HEIGHT / 2}
                    rx={balloonWidth / 2}
                    ry={balloonHeight / 2}
                    fill="url(#balloonGradient)"
                    stroke="#FFF"
                    strokeWidth="3"
                  />
                  <Ellipse
                    cx={MAX_BALLOON_WIDTH / 2}
                    cy={MAX_BALLOON_HEIGHT / 2}
                    rx={balloonWidth / 2}
                    ry={balloonHeight / 2}
                    fill="url(#balloonHighlight)"
                  />
                </Svg>
              </Animated.View>
              {/* Balloon String */}
              <Animated.View
                style={[
                  styles.string,
                  {
                    width: 2,
                    height: balloonHeightAnim.interpolate({
                      inputRange: [MIN_BALLOON_HEIGHT, MAX_BALLOON_HEIGHT],
                      outputRange: [50, 100],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.instructionText}>
              Blow to inflate the balloon!
            </Text>
          </View>
        )}

        {/* Round Success Animation */}
        <RoundSuccessAnimation
          visible={showRoundSuccess}
          stars={roundResults[roundResults.length - 1]?.stars}
        />

        {/* Round Complete - Keep for UI state but animation is shown above */}
        {gameState === 'roundComplete' && !showRoundSuccess && (
          <View style={styles.roundCompleteContainer}>
            <Text style={styles.roundCompleteText}>
              Round {currentRound} Complete!
            </Text>
            <View style={styles.starsDisplay}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={40}
                  color={i < roundResults[roundResults.length - 1]?.stars ? '#FFD700' : '#CCC'}
                />
              ))}
            </View>
          </View>
        )}

        {/* Error */}
        {jawError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{jawError}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
  },
  backButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  roundText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  meterContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  calibrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calibrationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 32,
    borderRadius: 20,
    alignItems: 'center',
  },
  calibrationText: {
    fontSize: 18,
    color: '#FFF',
    marginTop: 16,
    textAlign: 'center',
  },
  countdownContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  gameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balloonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  string: {
    backgroundColor: '#8B4513',
    marginTop: 4,
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginTop: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  roundCompleteContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 24,
  },
  starsDisplay: {
    flexDirection: 'row',
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
});


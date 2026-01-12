/**
 * Blow Out the Candle Game
 * Candle flickers and extinguishes with strong blow
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
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

interface RoundResult {
  round: number;
  stars: number;
  extinguished: boolean;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const EXTINGUISH_THRESHOLD = 0.7; // Blow intensity needed
const EXTINGUISH_DURATION = 1000; // Must sustain for 1 second
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

export function BlowOutTheCandleGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [flameExtinguished, setFlameExtinguished] = useState(false);
  const [flameSize, setFlameSize] = useState(1);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    extinguishedCount: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const blowDetector = useRef(new BlowDetector(800, 0.4));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flameSizeAnim = useRef(new Animated.Value(1)).current;
  const flameFlickerAnim = useRef(new Animated.Value(0)).current;
  const smokeOpacity = useRef(new Animated.Value(0)).current;
  const extinguishStartTime = useRef<number | null>(null);

  // Update flame based on blow
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || flameExtinguished) return;

    const protrusionValue = (protrusion as number) || 0;
    const blowState = blowDetector.current.update(isOpen || false, protrusionValue, ratio || 0);

    // Flicker flame based on blow intensity
    const flickerAmount = blowState.intensity * 0.3;
    setFlameSize(1 + flickerAmount);

    // Check if strong enough blow to extinguish
    if (blowState.intensity >= EXTINGUISH_THRESHOLD && blowState.isSustained) {
      if (!extinguishStartTime.current) {
        extinguishStartTime.current = Date.now();
      } else if (Date.now() - extinguishStartTime.current >= EXTINGUISH_DURATION) {
        // Extinguish candle
        setFlameExtinguished(true);
        extinguishCandle();
      }
    } else {
      extinguishStartTime.current = null;
    }
  }, [isOpen, protrusion, ratio, isDetecting, gameState, flameExtinguished]);

  // Animate flame size
  useEffect(() => {
    Animated.timing(flameSizeAnim, {
      toValue: flameSize,
      duration: 100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [flameSize]);

  // Flicker animation
  useEffect(() => {
    if (gameState === 'playing' && !flameExtinguished) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(flameFlickerAnim, {
            toValue: 1,
            duration: 300 + Math.random() * 200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(flameFlickerAnim, {
            toValue: 0,
            duration: 300 + Math.random() * 200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [gameState, flameExtinguished]);

  // Extinguish candle
  const extinguishCandle = useCallback(() => {
    // Animate flame out
    Animated.parallel([
      Animated.timing(flameSizeAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(smokeOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    speak('Great! You blew out the candle!');
    setTimeout(() => {
      endRound();
    }, 1000);
  }, []);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    blowDetector.current.reset();
    setFlameExtinguished(false);
    setFlameSize(1);
    setTimeElapsed(0);
    extinguishStartTime.current = null;
    flameSizeAnim.setValue(1);
    smokeOpacity.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Blow Out the Candle! Blow strongly into your device to extinguish the candle. ' +
        'The flame will flicker as you blow. Show your face to the camera to start!'
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
        speak(prev - 1 === 0 ? 'Go! Blow out the candle!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setFlameExtinguished(false);
    setFlameSize(1);
    setTimeElapsed(0);
    extinguishStartTime.current = null;
    flameSizeAnim.setValue(1);
    smokeOpacity.setValue(0);
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      // Timeout after 20 seconds
      if (elapsed >= ROUND_TIME_MS / 1000 && !flameExtinguished) {
        endRound();
      }
    }, 100);
  }, [flameExtinguished]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;

    if (flameExtinguished && timeElapsed < 8) {
      stars = 3;
    } else if (flameExtinguished && timeElapsed < 20) {
      stars = 2;
    } else {
      // Check if strong flicker occurred (intensity > 0.5)
      stars = 0;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      extinguished: flameExtinguished,
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
  }, [currentRound, flameExtinguished, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const extinguishedCount = roundResults.filter(r => r.extinguished).length;
    const accuracy = Math.round((extinguishedCount / requiredRounds) * 100);

    const stats = {
      totalRounds: requiredRounds,
      extinguishedCount,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    setShowCongratulations(true);

    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'blow-out-candle',
        correct: totalStars,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['airflow', 'oral-motor', 'breath-control', 'coordination'],
        meta: {
          totalRounds: requiredRounds,
          extinguishedCount,
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
        message="Candle Master!"
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

  const candleWidth = isTablet ? 60 : isMobile ? 40 : 50;
  const candleHeight = isTablet ? 200 : isMobile ? 150 : 180;
  const flameBaseSize = isTablet ? 30 : isMobile ? 20 : 25;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#1A1A2E', '#16213E', '#0F3460']}
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
            <View style={styles.candleContainer}>
              {/* Candle */}
              <Svg width={candleWidth} height={candleHeight}>
                <Defs>
                  <SvgLinearGradient id="candleGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <Stop offset="0%" stopColor="#F5F5DC" stopOpacity="1" />
                    <Stop offset="100%" stopColor="#D4AF37" stopOpacity="1" />
                  </SvgLinearGradient>
                </Defs>
                <Ellipse
                  cx={candleWidth / 2}
                  cy={candleHeight}
                  rx={candleWidth / 2}
                  ry={10}
                  fill="#8B4513"
                />
                <Path
                  d={`M 0 ${candleHeight - 10} L 0 0 L ${candleWidth} 0 L ${candleWidth} ${candleHeight - 10} Z`}
                  fill="url(#candleGradient)"
                />
              </Svg>

              {/* Flame */}
              {!flameExtinguished && (
                <Animated.View
                  style={{
                    position: 'absolute',
                    top: -flameBaseSize * 1.5,
                    left: candleWidth / 2 - flameBaseSize / 2,
                    transform: [
                      {
                        scale: flameSizeAnim.interpolate({
                          inputRange: [0, 2],
                          outputRange: [0, 1],
                        }),
                      },
                      {
                        translateX: flameFlickerAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 5],
                        }),
                      },
                    ],
                  }}
                >
                  <Svg width={flameBaseSize} height={flameBaseSize * 1.5}>
                    <Defs>
                      <RadialGradient id="flameGradient" cx="50%" cy="50%" r="50%">
                        <Stop offset="0%" stopColor="#FFD700" stopOpacity="1" />
                        <Stop offset="50%" stopColor="#FF8C00" stopOpacity="1" />
                        <Stop offset="100%" stopColor="#FF4500" stopOpacity="0.8" />
                      </RadialGradient>
                    </Defs>
                    <Path
                      d={`M ${flameBaseSize / 2} ${flameBaseSize * 1.5} 
                          Q ${flameBaseSize * 0.3} ${flameBaseSize * 0.8} ${flameBaseSize / 2} ${flameBaseSize * 0.2}
                          Q ${flameBaseSize * 0.7} ${flameBaseSize * 0.8} ${flameBaseSize / 2} ${flameBaseSize * 1.5} Z`}
                      fill="url(#flameGradient)"
                    />
                  </Svg>
                </Animated.View>
              )}

              {/* Smoke */}
              {flameExtinguished && (
                <Animated.View
                  style={{
                    position: 'absolute',
                    top: -flameBaseSize * 2,
                    left: candleWidth / 2 - 20,
                    opacity: smokeOpacity,
                  }}
                >
                  <Svg width={40} height={60}>
                    <Circle cx={10} cy={10} r={8} fill="#808080" opacity="0.6" />
                    <Circle cx={20} cy={20} r={10} fill="#808080" opacity="0.5" />
                    <Circle cx={30} cy={30} r={8} fill="#808080" opacity="0.4" />
                  </Svg>
                </Animated.View>
              )}
            </View>

            <Text style={styles.instructionText}>
              {flameExtinguished ? 'Great! Candle extinguished!' : 'Blow strongly to extinguish the candle!'}
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
  candleContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 300,
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


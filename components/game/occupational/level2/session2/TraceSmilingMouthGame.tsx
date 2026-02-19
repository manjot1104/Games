import { ResultToast, SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { generateArcPath, isPointOnPath, Point } from '@/utils/pathUtils';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    PanResponder,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const TOTAL_ROUNDS = 5;

// Difficulty: Level 1 = smooth curve, Level 2 = deeper curve
const MOUTH_CURVES = [
  { depth: 0.15, tolerance: 50 }, // Level 1: Gentle smile
  { depth: 0.25, tolerance: 45 }, // Level 2: Deeper smile
  { depth: 0.35, tolerance: 40 }, // Level 3: Even deeper
  { depth: 0.45, tolerance: 35 }, // Level 4
  { depth: 0.55, tolerance: 30 }, // Level 5: Deepest smile
];

const getResponsiveSize = (baseSize: number, isTablet: boolean, isMobile: boolean) => {
  if (isTablet) return baseSize * 1.3;
  if (isMobile) return baseSize * 0.9;
  return baseSize;
};

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    stopTTS();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('speak error', e);
  }
}

export const TraceSmilingMouthGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_ROUNDS,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;

  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    successfulTraces: number;
    averageAccuracy: number;
    xpAwarded: number;
  } | null>(null);

  const [currentRound, setCurrentRound] = useState(0);
  const [isTracing, setIsTracing] = useState(false);
  const [traceProgress, setTraceProgress] = useState(0);
  const [mouthPath, setMouthPath] = useState<Point[]>([]);
  const [glowPosition, setGlowPosition] = useState<Point | null>(null);
  const [isOnPath, setIsOnPath] = useState(true);
  const [roundComplete, setRoundComplete] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'success' | null>(null);
  const [sparkleVisible, setSparkleVisible] = useState(false);
  const [happinessLevel, setHappinessLevel] = useState(0); // 0-1, affects face emoji

  const [successfulTraces, setSuccessfulTraces] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);

  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const faceScale = useRef(new Animated.Value(1)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;

  const generateMouthPath = useCallback((roundIndex: number): Point[] => {
    const config = MOUTH_CURVES[Math.min(roundIndex, MOUTH_CURVES.length - 1)];
    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT * 0.5;
    const width = SCREEN_WIDTH * 0.4;
    const depth = width * config.depth;

    // Generate smile curve (arc)
    const startAngle = Math.PI * 0.2;
    const endAngle = Math.PI * 0.8;
    const radius = width / 2;
    
    return generateArcPath(
      { x: centerX, y: centerY + depth },
      radius,
      startAngle,
      endAngle,
      80
    );
  }, [SCREEN_WIDTH, SCREEN_HEIGHT]);

  const pathToSvgString = useCallback((path: Point[]): string => {
    if (path.length === 0) return '';
    let d = `M ${path[0].x} ${path[0].y}`;
    for (let i = 1; i < path.length; i++) {
      d += ` L ${path[i].x} ${path[i].y}`;
    }
    return d;
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (roundComplete) return;
        const { locationX, locationY } = evt.nativeEvent;
        handleTraceStart({ x: locationX, y: locationY });
      },
      onPanResponderMove: (evt) => {
        if (roundComplete || !isTracing) return;
        const { locationX, locationY } = evt.nativeEvent;
        handleTraceMove({ x: locationX, y: locationY });
      },
      onPanResponderRelease: () => {
        handleTraceEnd();
      },
    })
  ).current;

  const handleTraceStart = (point: Point) => {
    setIsTracing(true);
    setGlowPosition(point);
    glowOpacity.setValue(1);
    Animated.spring(glowScale, {
      toValue: 1.2,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  };

  const handleTraceMove = (point: Point) => {
    if (!mouthPath.length) return;
    setGlowPosition(point);
    
    const config = MOUTH_CURVES[Math.min(currentRound, MOUTH_CURVES.length - 1)];
    const onPath = isPointOnPath(point, mouthPath, config.tolerance);
    setIsOnPath(onPath);

    if (onPath) {
      let minDist = Infinity;
      let closestIndex = 0;
      for (let i = 0; i < mouthPath.length; i++) {
        const dx = point.x - mouthPath[i].x;
        const dy = point.y - mouthPath[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }
      const progress = closestIndex / mouthPath.length;
      setTraceProgress(progress);
      setHappinessLevel(progress);

      Animated.timing(progressBarWidth, {
        toValue: progress * 100,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      // Face becomes happier as progress increases
      Animated.spring(faceScale, {
        toValue: 1 + progress * 0.1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();

      if (progress >= 0.95 && !roundComplete) {
        handleRoundComplete();
      }
    }
  };

  const handleTraceEnd = () => {
    setIsTracing(false);
    Animated.parallel([
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(glowScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleRoundComplete = () => {
    setRoundComplete(true);
    setIsTracing(false);
    setSuccessfulTraces(prev => prev + 1);
    setTotalAccuracy(prev => prev + traceProgress * 100);
    setHappinessLevel(1);

    setSparkleVisible(true);
    setShowFeedback('success');
    speak('You made the face happy!');
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    Animated.sequence([
      Animated.spring(faceScale, {
        toValue: 1.2,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.spring(faceScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      setSparkleVisible(false);
      setShowFeedback(null);
    }, 1500);

    setTimeout(() => {
      if (currentRound < requiredRounds - 1) {
        startNextRound();
      } else {
        finishGame();
      }
    }, 2000);
  };

  const startNextRound = () => {
    setCurrentRound(prev => prev + 1);
    setTraceProgress(0);
    setRoundComplete(false);
    setHappinessLevel(0);
    setGlowPosition(null);
    progressBarWidth.setValue(0);
    faceScale.setValue(1);
    
    const newPath = generateMouthPath(currentRound + 1);
    setMouthPath(newPath);
  };

  const startRound = useCallback(() => {
    const path = generateMouthPath(currentRound);
    setMouthPath(path);
    setRoundComplete(false);
    setTraceProgress(0);
    setHappinessLevel(0);
    progressBarWidth.setValue(0);
    faceScale.setValue(1);
    
    speak('Trace the smile to make the face happy!');
  }, [currentRound, generateMouthPath]);

  const finishGame = useCallback(async () => {
    const avgAccuracy = totalAccuracy / requiredRounds;
    const xp = successfulTraces * 50;

    setFinalStats({
      totalRounds: requiredRounds,
      successfulTraces,
      averageAccuracy: avgAccuracy,
      xpAwarded: xp,
    });

    clearScheduledSpeech();

    try {
      await logGameAndAward({
        type: 'trace-smiling-mouth',
        correct: successfulTraces,
        total: requiredRounds,
        accuracy: avgAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['emotion-engagement', 'curve-recognition', 'fine-motor-control', 'occupational-therapy'],
        incorrectAttempts: requiredRounds - successfulTraces,
        meta: {
          averageAccuracy: avgAccuracy,
        },
      });
      setGameFinished(true);
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
      setGameFinished(true);
    }
  }, [successfulTraces, requiredRounds, totalAccuracy, onComplete]);

  useEffect(() => {
    startRound();
  }, []);

  if (gameFinished && finalStats) {
    return (
      <ResultCard
        correct={finalStats.successfulTraces}
        total={finalStats.totalRounds}
        accuracy={finalStats.averageAccuracy}
        xpAwarded={finalStats.xpAwarded}
        logTimestamp={null}
        onHome={onBack}
        onPlayAgain={() => {
          setGameFinished(false);
          setFinalStats(null);
          setCurrentRound(0);
          setSuccessfulTraces(0);
          setTotalAccuracy(0);
          setTraceProgress(0);
          setRoundComplete(false);
          setHappinessLevel(0);
          progressBarWidth.setValue(0);
          startRound();
        }}
      />
    );
  }

  const config = MOUTH_CURVES[Math.min(currentRound, MOUTH_CURVES.length - 1)];
  const pathString = pathToSvgString(mouthPath);
  const faceSize = getResponsiveSize(200, isTablet, isMobile);
  const glowSize = getResponsiveSize(40, isTablet, isMobile);
  const faceEmoji = happinessLevel > 0.8 ? '😄' : happinessLevel > 0.5 ? '😊' : '😐';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24']}
        style={styles.gradient}
      >
        <View style={[styles.header, isMobile && styles.headerMobile]}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Trace the Smile</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              Round {currentRound + 1} / {requiredRounds}
            </Text>
          </View>
        </View>

        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <Svg style={StyleSheet.absoluteFill} width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>

            {/* Mouth path - only traceable part */}
            <Path
              d={pathString}
              stroke="#EF4444"
              strokeWidth={30}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Glow effect */}
            {glowPosition && (
              <>
                <Circle
                  cx={glowPosition.x}
                  cy={glowPosition.y}
                  r={glowSize}
                  fill={isOnPath ? '#22C55E' : '#EF4444'}
                  opacity={0.3}
                />
                <Circle
                  cx={glowPosition.x}
                  cy={glowPosition.y}
                  r={glowSize / 2}
                  fill={isOnPath ? '#22C55E' : '#EF4444'}
                  opacity={1}
                />
              </>
            )}
          </Svg>

          <View style={[styles.progressContainer, isMobile && styles.progressContainerMobile]}>
            <View style={styles.progressBarBackground}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    width: progressBarWidth.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isMobile && styles.progressTextMobile]}>
              {Math.round(traceProgress * 100)}% Happy
            </Text>
          </View>

          {!isTracing && !roundComplete && (
            <View style={styles.instructionContainer}>
              <Text style={[styles.instructionText, isMobile && styles.instructionTextMobile]}>
                👆 Trace the smile to make the face happy!
              </Text>
            </View>
          )}

          <ResultToast
            text="You made the face happy!"
            type="ok"
            show={showFeedback === 'success'}
          />

          <SparkleBurst visible={sparkleVisible} color="#FCD34D" count={15} size={8} />

          {/* Face - rendered outside SVG */}
          <Animated.View
            style={[
              styles.faceContainer,
              {
                left: SCREEN_WIDTH / 2 - faceSize / 2,
                top: SCREEN_HEIGHT * 0.35 - faceSize / 2,
                width: faceSize,
                height: faceSize,
                transform: [{ scale: faceScale }],
              },
            ]}
          >
            <Text style={{ fontSize: faceSize * 0.8, textAlign: 'center' }}>{faceEmoji}</Text>
          </Animated.View>
        </View>

        <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
          <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
            Successful: {successfulTraces} / {currentRound + 1}
          </Text>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(254, 243, 199, 0.95)',
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
  headerText: { flex: 1 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  titleMobile: { fontSize: 20 },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  subtitleMobile: { fontSize: 12 },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  faceContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
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
    backgroundColor: '#22C55E',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  progressTextMobile: { fontSize: 12 },
  instructionContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 16,
    borderRadius: 16,
    zIndex: 10,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
  },
  instructionTextMobile: { fontSize: 16 },
  statsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
  },
  statsContainerMobile: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  statsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  statsTextMobile: { fontSize: 14 },
  faceContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});


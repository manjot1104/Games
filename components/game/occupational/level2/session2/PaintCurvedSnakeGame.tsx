import { ResultToast, SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { isPointOnPath, Point } from '@/utils/pathUtils';
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

const COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'];

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

export const PaintCurvedSnakeGame: React.FC<Props> = ({
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
    successfulRounds: number;
    averageAccuracy: number;
    xpAwarded: number;
  } | null>(null);

  const [currentRound, setCurrentRound] = useState(0);
  const [isTracing, setIsTracing] = useState(false);
  const [traceProgress, setTraceProgress] = useState(0);
  const [snakePath, setSnakePath] = useState<Point[]>([]);
  const [paintedPath, setPaintedPath] = useState<Point[]>([]);
  const [glowPosition, setGlowPosition] = useState<Point | null>(null);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [roundComplete, setRoundComplete] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'success' | null>(null);
  const [sparkleVisible, setSparkleVisible] = useState(false);
  const [snakeWiggle, setSnakeWiggle] = useState(false);

  const [successfulRounds, setSuccessfulRounds] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);

  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const snakeScale = useRef(new Animated.Value(1)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;

  const generateSnakePath = useCallback((roundIndex: number): Point[] => {
    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT * 0.5;
    const curveIntensity = 0.3 + roundIndex * 0.1;

    // Generate wavy snake path
    const path: Point[] = [];
    const startX = SCREEN_WIDTH * 0.1;
    const endX = SCREEN_WIDTH * 0.9;
    const segments = 100;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = startX + (endX - startX) * t;
      const y = centerY + Math.sin(t * Math.PI * 4) * SCREEN_HEIGHT * 0.15 * curveIntensity;
      path.push({ x, y });
    }
    return path;
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
    setPaintedPath([]);
    glowOpacity.setValue(1);
    Animated.spring(glowScale, {
      toValue: 1.2,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  };

  const handleTraceMove = (point: Point) => {
    if (!snakePath.length) return;
    setGlowPosition(point);
    
    const tolerance = 40;
    const onPath = isPointOnPath(point, snakePath, tolerance);

    if (onPath) {
      // Add point to painted path
      setPaintedPath(prev => [...prev, point]);

      // Calculate progress
      let minDist = Infinity;
      let closestIndex = 0;
      for (let i = 0; i < snakePath.length; i++) {
        const dx = point.x - snakePath[i].x;
        const dy = point.y - snakePath[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }
      const progress = closestIndex / snakePath.length;
      setTraceProgress(progress);

      Animated.timing(progressBarWidth, {
        toValue: progress * 100,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: false,
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
    setSuccessfulRounds(prev => prev + 1);
    setTotalAccuracy(prev => prev + traceProgress * 100);

    // Snake wiggle animation
    setSnakeWiggle(true);
    Animated.sequence([
      Animated.timing(snakeScale, {
        toValue: 1.1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(snakeScale, {
        toValue: 0.95,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(snakeScale, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setSnakeWiggle(false);
    });

    setSparkleVisible(true);
    setShowFeedback('success');
    speak('Great painting!');
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

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
    setPaintedPath([]);
    setGlowPosition(null);
    setSelectedColor(COLORS[currentRound % COLORS.length]);
    progressBarWidth.setValue(0);
    snakeScale.setValue(1);
    
    const newPath = generateSnakePath(currentRound + 1);
    setSnakePath(newPath);
  };

  const startRound = useCallback(() => {
    const path = generateSnakePath(currentRound);
    setSnakePath(path);
    setRoundComplete(false);
    setTraceProgress(0);
    setPaintedPath([]);
    setSelectedColor(COLORS[currentRound % COLORS.length]);
    progressBarWidth.setValue(0);
    snakeScale.setValue(1);
    
    speak('Paint the snake by tracing the path!');
  }, [currentRound, generateSnakePath]);

  const finishGame = useCallback(async () => {
    const avgAccuracy = totalAccuracy / requiredRounds;
    const xp = successfulRounds * 50;

    setFinalStats({
      totalRounds: requiredRounds,
      successfulRounds,
      averageAccuracy: avgAccuracy,
      xpAwarded: xp,
    });

    clearScheduledSpeech();

    try {
      await logGameAndAward({
        type: 'paint-curved-snake',
        correct: successfulRounds,
        total: requiredRounds,
        accuracy: avgAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['motivation', 'path-completion', 'fine-motor-control', 'occupational-therapy'],
        incorrectAttempts: requiredRounds - successfulRounds,
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
  }, [successfulRounds, requiredRounds, totalAccuracy, onComplete]);

  useEffect(() => {
    startRound();
  }, []);

  if (gameFinished && finalStats) {
    return (
      <ResultCard
        correct={finalStats.successfulRounds}
        total={finalStats.totalRounds}
        accuracy={finalStats.averageAccuracy}
        xpAwarded={finalStats.xpAwarded}
        logTimestamp={null}
        onHome={onBack}
        onPlayAgain={() => {
          setGameFinished(false);
          setFinalStats(null);
          setCurrentRound(0);
          setSuccessfulRounds(0);
          setTotalAccuracy(0);
          setTraceProgress(0);
          setRoundComplete(false);
          setPaintedPath([]);
          progressBarWidth.setValue(0);
          startRound();
        }}
      />
    );
  }

  const snakeString = pathToSvgString(snakePath);
  const paintedString = pathToSvgString(paintedPath);
  const glowSize = getResponsiveSize(40, isTablet, isMobile);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0', '#86EFAC']}
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
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Paint the Snake</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              Round {currentRound + 1} / {requiredRounds}
            </Text>
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

        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <Svg style={StyleSheet.absoluteFill} width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
            {/* Snake outline */}
            <Path
              d={snakeString}
              stroke="#64748B"
              strokeWidth={35}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Painted path (fills as child traces) */}
            {paintedPath.length > 1 && (
              <Path
                d={paintedString}
                stroke={selectedColor}
                strokeWidth={30}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Glow effect */}
            {glowPosition && (
              <>
                <Circle
                  cx={glowPosition.x}
                  cy={glowPosition.y}
                  r={glowSize}
                  fill={selectedColor}
                  opacity={0.3}
                />
                <Circle
                  cx={glowPosition.x}
                  cy={glowPosition.y}
                  r={glowSize / 2}
                  fill={selectedColor}
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
                    backgroundColor: selectedColor,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isMobile && styles.progressTextMobile]}>
              {Math.round(traceProgress * 100)}% Painted
            </Text>
          </View>

          {!isTracing && !roundComplete && (
            <View style={styles.instructionContainer}>
              <Text style={[styles.instructionText, isMobile && styles.instructionTextMobile]}>
                👆 Trace to paint the snake!
              </Text>
            </View>
          )}

          <ResultToast
            text="Great painting!"
            type="ok"
            show={showFeedback === 'success'}
          />

          <SparkleBurst visible={sparkleVisible} color={selectedColor} count={15} size={8} />
        </View>

        <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
          <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
            Successful: {successfulRounds} / {currentRound + 1}
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
  gameArea: {
    flex: 1,
    position: 'relative',
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
});


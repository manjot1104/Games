import { ResultToast, SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { isPointOnPath, Point, snapToPath } from '@/utils/pathUtils';
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
import Svg, { Path } from 'react-native-svg';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const TOTAL_ROUNDS = 5;
const MAX_SPEED = 3; // Pixels per frame (auto-limited)
const ROAD_WIDTH = 60;

// Responsive sizing
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

export const DriveCarCurvyRoadGame: React.FC<Props> = ({
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
    totalTime: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  // Game state
  const [currentRound, setCurrentRound] = useState(0);
  const [carPosition, setCarPosition] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isOnRoad, setIsOnRoad] = useState(true);
  const [roadPath, setRoadPath] = useState<Point[]>([]);
  const [roundComplete, setRoundComplete] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'success' | null>(null);
  const [sparkleVisible, setSparkleVisible] = useState(false);
  const [roadHighlight, setRoadHighlight] = useState(false);

  // Scoring
  const [successfulRounds, setSuccessfulRounds] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);
  const [timeOnRoad, setTimeOnRoad] = useState(0);
  const [roundStartTime, setRoundStartTime] = useState(0);

  // Animations
  const carRotation = useRef(new Animated.Value(0)).current;
  const carScale = useRef(new Animated.Value(1)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;

  const lastCarPosition = useRef<Point>({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);

  // Generate curvy road path
  const generateRoadPath = useCallback((roundIndex: number): Point[] => {
    const startX = SCREEN_WIDTH * 0.1;
    const endX = SCREEN_WIDTH * 0.9;
    const centerY = SCREEN_HEIGHT * 0.5;
    const curveHeight = SCREEN_HEIGHT * 0.3 * (1 + roundIndex * 0.2); // More curves in later rounds

    const start: Point = { x: startX, y: centerY };
    const end: Point = { x: endX, y: centerY };
    const control1: Point = { x: SCREEN_WIDTH * 0.3, y: centerY - curveHeight };
    const control2: Point = { x: SCREEN_WIDTH * 0.7, y: centerY + curveHeight };

    // Generate smooth curve using bezier
    const path: Point[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const x =
        (1 - t) * (1 - t) * (1 - t) * start.x +
        3 * (1 - t) * (1 - t) * t * control1.x +
        3 * (1 - t) * t * t * control2.x +
        t * t * t * end.x;
      const y =
        (1 - t) * (1 - t) * (1 - t) * start.y +
        3 * (1 - t) * (1 - t) * t * control1.y +
        3 * (1 - t) * t * t * control2.y +
        t * t * t * end.y;
      path.push({ x, y });
    }
    return path;
  }, [SCREEN_WIDTH, SCREEN_HEIGHT]);

  // Convert path to SVG string
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
        setIsDragging(true);
        updateCarPosition({ x: locationX, y: locationY });
      },
      onPanResponderMove: (evt) => {
        if (roundComplete || !isDragging) return;
        const { locationX, locationY } = evt.nativeEvent;
        updateCarPosition({ x: locationX, y: locationY });
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
      },
    })
  ).current;

  const updateCarPosition = (targetPoint: Point) => {
    // Snap car to nearest point on road (with speed limiting)
    const snapped = snapToPath(targetPoint, roadPath, 100);
    
    // Calculate distance from last position
    const dx = snapped.x - lastCarPosition.current.x;
    const dy = snapped.y - lastCarPosition.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Limit speed
    if (distance > MAX_SPEED) {
      const angle = Math.atan2(dy, dx);
      snapped.x = lastCarPosition.current.x + Math.cos(angle) * MAX_SPEED;
      snapped.y = lastCarPosition.current.y + Math.sin(angle) * MAX_SPEED;
    }

    setCarPosition(snapped);
    lastCarPosition.current = snapped;

    // Check if on road
    const onRoad = isPointOnPath(snapped, roadPath, ROAD_WIDTH / 2);
    setIsOnRoad(onRoad);
    setRoadHighlight(onRoad);

    if (onRoad) {
      setTimeOnRoad(prev => prev + 1);
      
      // Calculate progress
      let minDist = Infinity;
      let closestIndex = 0;
      for (let i = 0; i < roadPath.length; i++) {
        const dist = Math.sqrt(
          Math.pow(snapped.x - roadPath[i].x, 2) + Math.pow(snapped.y - roadPath[i].y, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }
      const progress = closestIndex / roadPath.length;
      
      Animated.timing(progressBarWidth, {
        toValue: progress * 100,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      // Check completion
      if (progress >= 0.95 && !roundComplete) {
        handleRoundComplete();
      }

      // Calculate car rotation based on direction
      if (closestIndex > 0) {
        const prevPoint = roadPath[closestIndex - 1];
        const currentPoint = roadPath[closestIndex];
        const angle = Math.atan2(currentPoint.y - prevPoint.y, currentPoint.x - prevPoint.x);
        Animated.timing(carRotation, {
          toValue: angle * (180 / Math.PI),
          duration: 100,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
      }
    } else {
      // Off road - pause car (no fail, just gentle feedback)
      Animated.spring(carScale, {
        toValue: 0.9,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start(() => {
        Animated.spring(carScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }).start();
      });

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
  };

  const handleRoundComplete = () => {
    setRoundComplete(true);
    setIsDragging(false);
    setSuccessfulRounds(prev => prev + 1);
    
    const accuracy = (timeOnRoad / (Date.now() - roundStartTime)) * 100;
    setTotalAccuracy(prev => prev + accuracy);

    setSparkleVisible(true);
    setShowFeedback('success');
    speak('Great driving!');
    
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
    setRoundComplete(false);
    setTimeOnRoad(0);
    progressBarWidth.setValue(0);
    carRotation.setValue(0);
    
    const newPath = generateRoadPath(currentRound + 1);
    setRoadPath(newPath);
    setCarPosition(newPath[0]);
    lastCarPosition.current = newPath[0];
    setRoundStartTime(Date.now());
  };

  const startRound = useCallback(() => {
    const path = generateRoadPath(currentRound);
    setRoadPath(path);
    setCarPosition(path[0]);
    lastCarPosition.current = path[0];
    setRoundStartTime(Date.now());
    setRoundComplete(false);
    setTimeOnRoad(0);
    progressBarWidth.setValue(0);
    carRotation.setValue(0);
    
    speak('Drive the car along the curvy road!');
  }, [currentRound, generateRoadPath]);

  const finishGame = useCallback(async () => {
    const totalTime = Date.now() - roundStartTime;
    const avgAccuracy = totalAccuracy / requiredRounds;
    const xp = successfulRounds * 50;

    setFinalStats({
      totalRounds: requiredRounds,
      successfulRounds,
      averageAccuracy: avgAccuracy,
      totalTime,
      xpAwarded: xp,
    });

    clearScheduledSpeech();

    try {
      await logGameAndAward({
        type: 'drive-car-curvy-road',
        correct: successfulRounds,
        total: requiredRounds,
        accuracy: avgAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['continuous-motion', 'visual-tracking', 'curve-tracing', 'occupational-therapy'],
        incorrectAttempts: requiredRounds - successfulRounds,
        meta: {
          totalTime,
          averageAccuracy: avgAccuracy,
        },
      });
      setGameFinished(true);
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
      setGameFinished(true);
    }
  }, [successfulRounds, requiredRounds, totalAccuracy, roundStartTime, onComplete]);

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
        logTimestamp={logTimestamp}
        onHome={onBack}
        onPlayAgain={() => {
          setGameFinished(false);
          setFinalStats(null);
          setCurrentRound(0);
          setSuccessfulRounds(0);
          setTotalAccuracy(0);
          setTimeOnRoad(0);
          progressBarWidth.setValue(0);
          startRound();
        }}
      />
    );
  }

  const roadString = pathToSvgString(roadPath);
  const carSize = getResponsiveSize(50, isTablet, isMobile);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0', '#86EFAC']}
        style={styles.gradient}
      >
        {/* Header */}
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
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Drive the Car</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              Round {currentRound + 1} / {requiredRounds}
            </Text>
          </View>
        </View>

        {/* Game Area */}
        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <Svg style={StyleSheet.absoluteFill} width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
            {/* Road highlight when on path */}
            {roadHighlight && (
              <Path
                d={roadString}
                stroke="#22C55E"
                strokeWidth={ROAD_WIDTH + 10}
                strokeOpacity={0.3}
                fill="none"
                strokeLinecap="round"
              />
            )}

            {/* Main road path */}
            <Path
              d={roadString}
              stroke="#374151"
              strokeWidth={ROAD_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Road center line */}
            <Path
              d={roadString}
              stroke="#FCD34D"
              strokeWidth={3}
              strokeDasharray="10, 5"
              fill="none"
            />

          </Svg>

          {/* Progress Bar */}
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
              {isOnRoad ? '✅ On Road' : '⚠️ Off Road'}
            </Text>
          </View>

          {/* Instructions */}
          {!isDragging && !roundComplete && (
            <View style={styles.instructionContainer}>
              <Text style={[styles.instructionText, isMobile && styles.instructionTextMobile]}>
                👆 Drag the car along the road!
              </Text>
            </View>
          )}

          {/* Feedback */}
          <ResultToast
            text="Great driving!"
            type="ok"
            show={showFeedback === 'success'}
          />

          {/* Sparkle Effect */}
          <SparkleBurst visible={sparkleVisible} color="#22C55E" count={15} size={8} />

          {/* Car - rendered outside SVG */}
          <Animated.View
            style={[
              styles.carContainer,
              {
                left: carPosition.x - carSize / 2,
                top: carPosition.y - carSize / 2,
                width: carSize,
                height: carSize,
                transform: [
                  { rotate: carRotation.interpolate({
                    inputRange: [0, 360],
                    outputRange: ['0deg', '360deg'],
                  }) },
                  { scale: carScale },
                ],
              },
            ]}
          >
            <Text style={{ fontSize: carSize, textAlign: 'center' }}>🚗</Text>
          </Animated.View>
        </View>

        {/* Stats */}
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
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
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
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  titleMobile: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  subtitleMobile: {
    fontSize: 12,
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
  progressTextMobile: {
    fontSize: 12,
  },
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
  instructionTextMobile: {
    fontSize: 16,
  },
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
  statsTextMobile: {
    fontSize: 14,
  },
  carContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
});


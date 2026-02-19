import { ResultToast, SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { generateCurvePath, Point, snapToPath } from '@/utils/pathUtils';
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
const SNAP_DISTANCE = 60; // How far ball can snap to path

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

export const BallRollCurvedTrackGame: React.FC<Props> = ({
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
  const [ballPosition, setBallPosition] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [trackPath, setTrackPath] = useState<Point[]>([]);
  const [starPosition, setStarPosition] = useState<Point>({ x: 0, y: 0 });
  const [roundComplete, setRoundComplete] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'success' | null>(null);
  const [sparkleVisible, setSparkleVisible] = useState(false);

  const [successfulRounds, setSuccessfulRounds] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);

  const ballScale = useRef(new Animated.Value(1)).current;
  const starScale = useRef(new Animated.Value(1)).current;
  const starOpacity = useRef(new Animated.Value(1)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;

  const generateTrackPath = useCallback((roundIndex: number): { path: Point[]; starPos: Point } => {
    const startX = SCREEN_WIDTH * 0.15;
    const endX = SCREEN_WIDTH * 0.85;
    const centerY = SCREEN_HEIGHT * 0.5;
    const curveIntensity = 0.3 + roundIndex * 0.1;

    const start: Point = { x: startX, y: centerY };
    const end: Point = { x: endX, y: centerY };
    const control: Point = {
      x: SCREEN_WIDTH * 0.5,
      y: centerY - SCREEN_HEIGHT * 0.25 * curveIntensity,
    };

    const path = generateCurvePath(start, end, control, 80);
    return { path, starPos: end };
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
        setIsDragging(true);
        updateBallPosition({ x: locationX, y: locationY });
      },
      onPanResponderMove: (evt) => {
        if (roundComplete || !isDragging) return;
        const { locationX, locationY } = evt.nativeEvent;
        updateBallPosition({ x: locationX, y: locationY });
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
      },
    })
  ).current;

  const updateBallPosition = (targetPoint: Point) => {
    // Snap ball to nearest point on track (forgiving)
    const snapped = snapToPath(targetPoint, trackPath, SNAP_DISTANCE);
    setBallPosition(snapped);

    // Calculate progress
    let minDist = Infinity;
    let closestIndex = 0;
    for (let i = 0; i < trackPath.length; i++) {
      const dx = snapped.x - trackPath[i].x;
      const dy = snapped.y - trackPath[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }
    const progress = closestIndex / trackPath.length;

    Animated.timing(progressBarWidth, {
      toValue: progress * 100,
      duration: 50,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Check if reached star
    const dx = snapped.x - starPosition.x;
    const dy = snapped.y - starPosition.y;
    const distToStar = Math.sqrt(dx * dx + dy * dy);
    
    if (distToStar < 50 && !roundComplete) {
      handleRoundComplete();
    }
  };

  const handleRoundComplete = () => {
    setRoundComplete(true);
    setIsDragging(false);
    setSuccessfulRounds(prev => prev + 1);
    setTotalAccuracy(prev => prev + 100);

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

    setSparkleVisible(true);
    setShowFeedback('success');
    speak('Great job!');
    
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
    progressBarWidth.setValue(0);
    starScale.setValue(1);
    starOpacity.setValue(1);
    
    const { path, starPos } = generateTrackPath(currentRound + 1);
    setTrackPath(path);
    setBallPosition(path[0]);
    setStarPosition(starPos);
  };

  const startRound = useCallback(() => {
    const { path, starPos } = generateTrackPath(currentRound);
    setTrackPath(path);
    setBallPosition(path[0]);
    setStarPosition(starPos);
    setRoundComplete(false);
    progressBarWidth.setValue(0);
    starScale.setValue(1);
    starOpacity.setValue(1);
    
    speak('Roll the ball to the star!');
  }, [currentRound, generateTrackPath]);

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
        type: 'ball-roll-curved-track',
        correct: successfulRounds,
        total: requiredRounds,
        accuracy: avgAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['bilateral-coordination', 'smooth-movement', 'curve-tracing', 'occupational-therapy'],
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
          progressBarWidth.setValue(0);
          startRound();
        }}
      />
    );
  }

  const trackString = pathToSvgString(trackPath);
  const ballSize = getResponsiveSize(50, isTablet, isMobile);
  const starSize = getResponsiveSize(60, isTablet, isMobile);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC']}
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
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Ball Roll on Track</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              Round {currentRound + 1} / {requiredRounds}
            </Text>
          </View>
        </View>

        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <Svg style={StyleSheet.absoluteFill} width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
            {/* Track rail */}
            <Path
              d={trackString}
              stroke="#64748B"
              strokeWidth={20}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

          </Svg>

          {/* Star target - rendered outside SVG */}
          <Animated.View
            style={[
              styles.starContainer,
              {
                left: starPosition.x - starSize / 2,
                top: starPosition.y - starSize / 2,
                width: starSize,
                height: starSize,
                transform: [{ scale: starScale }],
                opacity: starOpacity,
              },
            ]}
          >
            <Text style={{ fontSize: starSize, textAlign: 'center' }}>⭐</Text>
          </Animated.View>

          {/* Ball - rendered outside SVG */}
          <Animated.View
            style={[
              styles.ballContainer,
              {
                left: ballPosition.x - ballSize / 2,
                top: ballPosition.y - ballSize / 2,
                width: ballSize,
                height: ballSize,
                transform: [{ scale: ballScale }],
              },
            ]}
          >
            <Text style={{ fontSize: ballSize, textAlign: 'center' }}>⚽</Text>
          </Animated.View>

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
              Roll to the star!
            </Text>
          </View>

          {!isDragging && !roundComplete && (
            <View style={styles.instructionContainer}>
              <Text style={[styles.instructionText, isMobile && styles.instructionTextMobile]}>
                👆 Drag the ball along the track!
              </Text>
            </View>
          )}

          <ResultToast
            text="Great job!"
            type="ok"
            show={showFeedback === 'success'}
          />

          <SparkleBurst visible={sparkleVisible} color="#FCD34D" count={15} size={8} />
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
    backgroundColor: 'rgba(240, 249, 255, 0.95)',
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
  ballContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  starContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
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


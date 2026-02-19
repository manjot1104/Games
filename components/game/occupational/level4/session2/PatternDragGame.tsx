import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 50;
const PATH_WIDTH = 10;
const TOLERANCE = 50;

type PatternType = 'zigzag' | 'wave' | 'steps';

const PatternDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [patternType, setPatternType] = useState<PatternType>('zigzag');
  const [progress, setProgress] = useState(0);

  const objectX = useSharedValue(SCREEN_WIDTH * 0.85);
  const objectY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const objectScale = useSharedValue(1);
  const startX = useSharedValue(SCREEN_WIDTH * 0.85);
  const startY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const endX = useSharedValue(SCREEN_WIDTH * 0.15);
  const endY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const generatePattern = useCallback(() => {
    const patterns: PatternType[] = ['zigzag', 'wave', 'steps'];
    const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
    setPatternType(randomPattern);
  }, []);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      objectScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      objectX.value = Math.max(OBJECT_SIZE / 2, Math.min(screenWidth.current - OBJECT_SIZE / 2, newX));
      objectY.value = Math.max(OBJECT_SIZE / 2, Math.min(screenHeight.current - OBJECT_SIZE / 2, newY));
      
      // Calculate progress along path
      const totalDist = Math.abs(startX.value - endX.value);
      const currentDist = Math.abs(objectX.value - startX.value);
      setProgress(Math.min(100, (currentDist / totalDist) * 100));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(objectX.value - endX.value, 2) + Math.pow(objectY.value - endY.value, 2)
      );

      if (distance <= TOLERANCE && progress > 80) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              generatePattern();
              resetObject();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect pattern!', 0.9, 'en-US' );
      } else {
        resetObject();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Follow the pattern!', 0.8, 'en-US' );
      }
    });

  const resetObject = useCallback(() => {
    objectX.value = withSpring(startX.value);
    objectY.value = withSpring(startY.value);
    setProgress(0);
  }, [objectX, objectY, startX, startY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'pattern-drag',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['motor-planning', 'drag-right-left'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      generatePattern();
      resetObject();
      speakTTS('Follow the pattern from right to left!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, generatePattern, resetObject]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const objectStyle = useAnimatedStyle(() => ({
    left: objectX.value - OBJECT_SIZE / 2,
    top: objectY.value - OBJECT_SIZE / 2,
    transform: [{ scale: objectScale.value }],
  }));

  const [patternPath, setPatternPath] = useState('');

  const updatePatternPath = useCallback(() => {
    const width = screenWidth.current || SCREEN_WIDTH;
    const height = screenHeight.current || SCREEN_HEIGHT;
    const sx = width * 0.85;
    const sy = height * 0.5;
    const ex = width * 0.15;
    const ey = height * 0.5;

    let path = '';
    switch (patternType) {
      case 'zigzag':
        const z1x = (sx + ex) / 2;
        const z1y = sy - height * 0.15;
        const z2x = (sx + ex) / 2;
        const z2y = sy + height * 0.15;
        path = `M ${sx} ${sy} L ${z1x} ${z1y} L ${z2x} ${z2y} L ${ex} ${ey}`;
        break;
      case 'wave':
        const w1x = sx - (sx - ex) * 0.33;
        const w1y = sy - height * 0.1;
        const w2x = sx - (sx - ex) * 0.66;
        const w2y = sy + height * 0.1;
        path = `M ${sx} ${sy} Q ${w1x} ${w1y} ${(sx + ex) / 2} ${sy} Q ${w2x} ${w2y} ${ex} ${ey}`;
        break;
      case 'steps':
        const s1x = sx - (sx - ex) * 0.5;
        const s1y = sy;
        const s2x = s1x;
        const s2y = sy - height * 0.1;
        path = `M ${sx} ${sy} L ${s1x} ${s1y} L ${s2x} ${s2y} L ${ex} ${ey}`;
        break;
      default:
        path = `M ${sx} ${sy} L ${ex} ${ey}`;
    }
    setPatternPath(path);
  }, [patternType]);

  useEffect(() => {
    updatePatternPath();
  }, [patternType, round, updatePatternPath]);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pattern Drag"
        emoji="📐"
        description="Follow the pattern while dragging from right to left!"
        skills={['Motor planning']}
        suitableFor="Children learning motor planning through pattern following"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            generatePattern();
            resetObject();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Pattern Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 📐 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Follow the pattern from right to left!
        </Text>
        <Text style={styles.patternLabel}>
          Pattern: {patternType.toUpperCase()}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          startX.value = screenWidth.current * 0.85;
          startY.value = screenHeight.current * 0.5;
          endX.value = screenWidth.current * 0.15;
          endY.value = screenHeight.current * 0.5;
          updatePatternPath();
          resetObject();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Svg style={StyleSheet.absoluteFill} width={screenWidth.current || SCREEN_WIDTH} height={screenHeight.current || SCREEN_HEIGHT}>
              {patternPath && (
                <Path
                  d={patternPath}
                  stroke="#10B981"
                  strokeWidth={PATH_WIDTH}
                  fill="none"
                  strokeLinecap="round"
                />
              )}
            </Svg>

            <Animated.View style={[styles.endMarker, { left: endX.value - 20, top: endY.value - 20 }]}>
              <Text style={styles.markerEmoji}>🎯</Text>
            </Animated.View>

            <Animated.View style={[styles.object, objectStyle]}>
              <Text style={styles.objectEmoji}>📦</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Motor planning
        </Text>
        <Text style={styles.footerSubtext}>
          Follow the pattern while dragging from right to left!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#10B981',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  patternLabel: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  endMarker: {
    position: 'absolute',
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  markerEmoji: {
    fontSize: 40,
  },
  object: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 30,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default PatternDragGame;

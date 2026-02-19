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
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 60;
const CATCHER_SIZE = 80;
const TOLERANCE = 70;
const FALL_SPEED = 2;

const DiagonalCatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [objectCaught, setObjectCaught] = useState(false);

  const catcherX = useSharedValue(SCREEN_WIDTH * 0.5);
  const catcherY = useSharedValue(SCREEN_HEIGHT * 0.8);
  const catcherScale = useSharedValue(1);
  const objectX = useSharedValue(SCREEN_WIDTH * 0.15);
  const objectY = useSharedValue(SCREEN_HEIGHT * 0.15);
  const objectVisible = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);

  const startObjectFall = useCallback(() => {
    if (done) return;
    
    setObjectCaught(false);
    const startCorner = Math.random() < 0.5 ? 'top-left' : 'top-right';
    const targetEndX = startCorner === 'top-left' ? screenWidth.current * 0.85 : screenWidth.current * 0.15;
    const targetEndY = screenHeight.current * 0.85;
    
    const startX = startCorner === 'top-left' ? screenWidth.current * 0.15 : screenWidth.current * 0.85;
    const startY = screenHeight.current * 0.15;
    
    objectX.value = startX;
    objectY.value = startY;
    objectVisible.value = 1;

    const animate = () => {
      if (done) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        return;
      }
      
      const dx = targetEndX - objectX.value;
      const dy = targetEndY - objectY.value;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < TOLERANCE) {
        // Check if caught
        const catcherDist = Math.sqrt(
          Math.pow(objectX.value - catcherX.value, 2) + Math.pow(objectY.value - catcherY.value, 2)
        );
        
        if (catcherDist <= TOLERANCE) {
          objectVisible.value = withTiming(0);
          setObjectCaught(true);
          setScore((s) => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound((r) => r + 1);
                startObjectFall();
              }, 1500);
            }
            return newScore;
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Caught it!', 0.9, 'en-US' );
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
          }
          return;
        } else {
          // Missed
          objectVisible.value = withTiming(0);
          setTimeout(() => {
            startObjectFall();
          }, 1000);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          speakTTS('Try again!', 0.8, 'en-US' );
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
          }
          return;
        }
      }
      
      const step = FALL_SPEED;
      const ratio = step / distance;
      objectX.value += dx * ratio;
      objectY.value += dy * ratio;
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animationRef.current = requestAnimationFrame(animate);
  }, [objectX, objectY, objectVisible, catcherX, catcherY, done, screenWidth, screenHeight]);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      catcherScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      catcherX.value = Math.max(CATCHER_SIZE / 2, Math.min(screenWidth.current - CATCHER_SIZE / 2, newX));
      catcherY.value = Math.max(CATCHER_SIZE / 2, Math.min(screenHeight.current - CATCHER_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      catcherScale.value = withSpring(1);
    });

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    try {
      await logGameAndAward({
        type: 'diagonal-catch',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['anticipation-skills', 'diagonal-drag'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setTimeout(() => {
        startObjectFall();
      }, 500);
      speakTTS('Catch the object coming diagonally!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, startObjectFall]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const catcherStyle = useAnimatedStyle(() => ({
    left: catcherX.value - CATCHER_SIZE / 2,
    top: catcherY.value - CATCHER_SIZE / 2,
    transform: [{ scale: catcherScale.value }],
  }));

  const objectStyle = useAnimatedStyle(() => ({
    left: objectX.value - OBJECT_SIZE / 2,
    top: objectY.value - OBJECT_SIZE / 2,
    opacity: objectVisible.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Diagonal Catch"
        emoji="🎯"
        description="Catch objects coming diagonally across the screen!"
        skills={['Anticipation skills']}
        suitableFor="Children learning anticipation skills through diagonal catching"
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
            setObjectCaught(false);
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
        <Text style={styles.title}>Diagonal Catch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Move the catcher to catch objects coming diagonally!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          catcherX.value = screenWidth.current * 0.5;
          catcherY.value = screenHeight.current * 0.8;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.catcher, catcherStyle]}>
              <Text style={styles.catcherEmoji}>🫴</Text>
            </Animated.View>

            <Animated.View style={[styles.object, objectStyle]}>
              <Text style={styles.objectEmoji}>⚽</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Anticipation skills
        </Text>
        <Text style={styles.footerSubtext}>
          Catch objects coming diagonally across the screen!
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
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
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
  catcher: {
    position: 'absolute',
    width: CATCHER_SIZE,
    height: CATCHER_SIZE,
    borderRadius: CATCHER_SIZE / 2,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  catcherEmoji: {
    fontSize: 50,
  },
  object: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  objectEmoji: {
    fontSize: 40,
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

export default DiagonalCatchGame;

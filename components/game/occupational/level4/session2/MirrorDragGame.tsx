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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HAND_SIZE = 60;
const TARGET_SIZE = 80;
const TOLERANCE = 50;

const MirrorDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handX = useSharedValue(SCREEN_WIDTH * 0.85);
  const handY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const handScale = useSharedValue(1);
  const targetX = useSharedValue(SCREEN_WIDTH * 0.15);
  const targetY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      handScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      handX.value = Math.max(HAND_SIZE / 2, Math.min(screenWidth.current - HAND_SIZE / 2, newX));
      handY.value = Math.max(HAND_SIZE / 2, Math.min(screenHeight.current - HAND_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      handScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(handX.value - targetX.value, 2) + Math.pow(handY.value - targetY.value, 2)
      );

      if (distance <= TOLERANCE) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              resetHand();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect mirror!', 0.9, 'en-US' );
      } else {
        resetHand();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Use right hand to drag to left target!', 0.8, 'en-US' );
      }
    });

  const resetHand = useCallback(() => {
    handX.value = withSpring(screenWidth.current * 0.85);
    handY.value = withSpring(screenHeight.current * 0.5);
  }, [handX, handY, screenWidth, screenHeight]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'mirror-drag',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['brain-hand-sync', 'drag-right-left'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetHand();
      speakTTS('Use right hand to drag to left target!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetHand]);

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

  const handStyle = useAnimatedStyle(() => ({
    left: handX.value - HAND_SIZE / 2,
    top: handY.value - HAND_SIZE / 2,
    transform: [{ scale: handScale.value }],
  }));

  const targetStyle = useAnimatedStyle(() => ({
    left: targetX.value - TARGET_SIZE / 2,
    top: targetY.value - TARGET_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Mirror Drag"
        emoji="👋"
        description="Use right hand to drag to left target!"
        skills={['Brain-hand sync']}
        suitableFor="Children learning brain-hand synchronization through mirror dragging"
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
            resetHand();
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
        <Text style={styles.title}>Mirror Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👋 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Use right hand to drag to left target!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          targetX.value = screenWidth.current * 0.15;
          targetY.value = screenHeight.current * 0.5;
          resetHand();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.target, targetStyle]}>
              <Text style={styles.targetEmoji}>🎯</Text>
              <Text style={styles.targetLabel}>LEFT TARGET</Text>
            </Animated.View>

            <Animated.View style={[styles.hand, handStyle]}>
              <Text style={styles.handEmoji}>👉</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Brain-hand sync
        </Text>
        <Text style={styles.footerSubtext}>
          Use right hand to drag to left target!
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
    color: '#8B5CF6',
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
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#8B5CF6',
    borderWidth: 4,
    borderColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  targetEmoji: {
    fontSize: 40,
  },
  targetLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#fff',
    marginTop: 2,
  },
  hand: {
    position: 'absolute',
    width: HAND_SIZE,
    height: HAND_SIZE,
    borderRadius: HAND_SIZE / 2,
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
  handEmoji: {
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

export default MirrorDragGame;

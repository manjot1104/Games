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
const STAR_SIZE = 50;
const BAG_SIZE = 100;
const TOLERANCE = 60;

const CollectStarsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const starX = useSharedValue(SCREEN_WIDTH * 0.85);
  const starY = useSharedValue(SCREEN_HEIGHT * 0.4);
  const starScale = useSharedValue(1);
  const bagX = useSharedValue(SCREEN_WIDTH * 0.15);
  const bagY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      starScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      starX.value = Math.max(STAR_SIZE / 2, Math.min(screenWidth.current - STAR_SIZE / 2, newX));
      starY.value = Math.max(STAR_SIZE / 2, Math.min(screenHeight.current - STAR_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      starScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(starX.value - bagX.value, 2) + Math.pow(starY.value - bagY.value, 2)
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
              resetStar();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Star collected!', 0.9, 'en-US' );
      } else {
        resetStar();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag star to the left bag!', 0.8, 'en-US' );
      }
    });

  const resetStar = useCallback(() => {
    starX.value = withSpring(screenWidth.current * 0.85);
    starY.value = withSpring(screenHeight.current * 0.4);
  }, [starX, starY, screenWidth, screenHeight]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'collect-stars',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['cross-body-reach', 'drag-right-left'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetStar();
      speakTTS('Drag stars from right side to left bag!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetStar]);

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

  const starStyle = useAnimatedStyle(() => ({
    left: starX.value - STAR_SIZE / 2,
    top: starY.value - STAR_SIZE / 2,
    transform: [{ scale: starScale.value }],
  }));

  const bagStyle = useAnimatedStyle(() => ({
    left: bagX.value - BAG_SIZE / 2,
    top: bagY.value - BAG_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Collect Stars"
        emoji="⭐"
        description="Drag stars from right side to left bag!"
        skills={['Cross-body reach']}
        suitableFor="Children learning cross-body reach through star collecting"
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
            resetStar();
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
        <Text style={styles.title}>Collect Stars</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⭐ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag stars from right to left bag!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          bagX.value = screenWidth.current * 0.15;
          bagY.value = screenHeight.current * 0.5;
          resetStar();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.bag, bagStyle]}>
              <Text style={styles.bagEmoji}>🎒</Text>
              <Text style={styles.bagLabel}>COLLECT</Text>
            </Animated.View>

            <Animated.View style={[styles.star, starStyle]}>
              <Text style={styles.starEmoji}>⭐</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Cross-body reach
        </Text>
        <Text style={styles.footerSubtext}>
          Drag stars from right side to left bag!
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
    color: '#F59E0B',
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
  bag: {
    position: 'absolute',
    width: BAG_SIZE,
    height: BAG_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  bagEmoji: {
    fontSize: 70,
    marginBottom: 5,
  },
  bagLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F59E0B',
  },
  star: {
    position: 'absolute',
    width: STAR_SIZE,
    height: STAR_SIZE,
    borderRadius: STAR_SIZE / 2,
    backgroundColor: '#FBBF24',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  starEmoji: {
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

export default CollectStarsGame;

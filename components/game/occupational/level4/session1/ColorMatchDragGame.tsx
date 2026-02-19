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
const COLOR_SIZE = 80;
const TOLERANCE = 50;

const COLORS = [
  { name: 'red', emoji: '🔴', color: '#EF4444' },
  { name: 'blue', emoji: '🔵', color: '#3B82F6' },
  { name: 'green', emoji: '🟢', color: '#10B981' },
  { name: 'yellow', emoji: '🟡', color: '#F59E0B' },
  { name: 'purple', emoji: '🟣', color: '#8B5CF6' },
];

const ColorMatchDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentColor, setCurrentColor] = useState(COLORS[0]);
  const [targetColor, setTargetColor] = useState(COLORS[0]);

  const colorX = useSharedValue(SCREEN_WIDTH * 0.15);
  const colorY = useSharedValue(SCREEN_HEIGHT * 0.4);
  const colorScale = useSharedValue(1);
  const targetX = useSharedValue(SCREEN_WIDTH * 0.85);
  const targetY = useSharedValue(SCREEN_HEIGHT * 0.4);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      colorScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      colorX.value = Math.max(COLOR_SIZE / 2, Math.min(screenWidth.current - COLOR_SIZE / 2, newX));
      colorY.value = Math.max(COLOR_SIZE / 2, Math.min(screenHeight.current - COLOR_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      colorScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(colorX.value - targetX.value, 2) + Math.pow(colorY.value - targetY.value, 2)
      );

      if (distance <= TOLERANCE && currentColor.name === targetColor.name) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              generateNewColors();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect match!', 0.9, 'en-US' );
      } else {
        resetColor();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        if (distance <= TOLERANCE) {
          speakTTS('Color does not match!', 0.8, 'en-US' );
        } else {
          speakTTS('Drag to the matching color!', 0.8, 'en-US' );
        }
      }
    });

  const generateNewColors = useCallback(() => {
    const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    setCurrentColor(randomColor);
    setTargetColor(randomColor);
    resetColor();
  }, []);

  const resetColor = useCallback(() => {
    colorX.value = withSpring(screenWidth.current * 0.15);
    colorY.value = withSpring(screenHeight.current * 0.4);
  }, [colorX, colorY, screenWidth, screenHeight]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'color-match-drag',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-matching', 'motor', 'drag-left-right'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      generateNewColors();
      speakTTS('Match the left color to the right same color!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, generateNewColors]);

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

  const colorStyle = useAnimatedStyle(() => ({
    left: colorX.value - COLOR_SIZE / 2,
    top: colorY.value - COLOR_SIZE / 2,
    transform: [{ scale: colorScale.value }],
  }));

  const targetStyle = useAnimatedStyle(() => ({
    left: targetX.value - COLOR_SIZE / 2,
    top: targetY.value - COLOR_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Color Match Drag"
        emoji="🎨"
        description="Match left color to right same color!"
        skills={['Visual matching', 'Motor']}
        suitableFor="Children learning visual matching and motor skills"
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
            generateNewColors();
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
        <Text style={styles.title}>Color Match Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Match left color to right same color!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          targetX.value = screenWidth.current * 0.85;
          targetY.value = screenHeight.current * 0.4;
          resetColor();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.targetColor, targetStyle]}>
              <Text style={styles.colorEmoji}>{targetColor.emoji}</Text>
              <Text style={styles.colorLabel}>MATCH</Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.colorCircle,
                { backgroundColor: currentColor.color },
                colorStyle,
              ]}
            >
              <Text style={styles.colorEmoji}>{currentColor.emoji}</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual matching • Motor
        </Text>
        <Text style={styles.footerSubtext}>
          Drag left color to right same color!
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
  targetColor: {
    position: 'absolute',
    width: COLOR_SIZE,
    height: COLOR_SIZE,
    borderRadius: COLOR_SIZE / 2,
    borderWidth: 4,
    borderColor: '#8B5CF6',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  colorCircle: {
    position: 'absolute',
    width: COLOR_SIZE,
    height: COLOR_SIZE,
    borderRadius: COLOR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  colorEmoji: {
    fontSize: 40,
  },
  colorLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8B5CF6',
    marginTop: 2,
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

export default ColorMatchDragGame;

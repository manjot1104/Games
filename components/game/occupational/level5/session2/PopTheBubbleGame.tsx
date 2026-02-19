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
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Pressable,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUBBLE_SIZE = 80;
const TOLERANCE = 50;

interface Bubble {
  id: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

const PopTheBubbleGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const hasSpokenRef = useRef(false);

  const generateBubble = useCallback(() => {
    const newBubble: Bubble = {
      id: `bubble-${Date.now()}`,
      x: Math.random() * (screenWidth.current - BUBBLE_SIZE) + BUBBLE_SIZE / 2,
      y: Math.random() * (screenHeight.current - BUBBLE_SIZE - 200) + BUBBLE_SIZE / 2 + 100,
      scale: 1,
      opacity: 1,
    };
    setBubbles([newBubble]);
  }, []);

  const handleBubblePop = useCallback((bubbleId: string) => {
    if (done || bubbles.length === 0) return;
    
    const bubble = bubbles.find(b => b.id === bubbleId);
    if (!bubble) return;

    // Pop the bubble!
    setBubbles((prev) => prev.map((b) => 
      b.id === bubbleId ? { ...b, scale: 2, opacity: 0 } : b
    ));

    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          generateBubble();
        }, 800);
      }
      return newScore;
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Pop!', 0.9, 'en-US' );
  }, [done, bubbles, generateBubble]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'pop-the-bubble',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['tap-accuracy', 'hand-eye-coordination', 'precision'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      if (round === 1) {
        hasSpokenRef.current = false;
      }
      generateBubble();
      setTimeout(() => {
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          speakTTS('Tap the bubble to pop it!', 0.8, 'en-US' );
        }
      }, 500);
    }
  }, [showInfo, round, done, generateBubble]);

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

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pop the Bubble"
        emoji="🫧"
        description="Tap the bubble to pop it! Build your tap accuracy."
        skills={['Tap accuracy']}
        suitableFor="Children learning precise tapping and hand-eye coordination"
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
            generateBubble();
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
        <Text style={styles.title}>Pop the Bubble</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🫧 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the bubble to pop it!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {bubbles.map((bubble) => (
          <Pressable
            key={bubble.id}
            onPress={() => handleBubblePop(bubble.id)}
            style={[
              styles.bubble,
              {
                left: bubble.x - BUBBLE_SIZE / 2,
                top: bubble.y - BUBBLE_SIZE / 2,
                transform: [{ scale: bubble.scale }],
                opacity: bubble.opacity,
              },
            ]}
          >
            <Text style={styles.bubbleEmoji}>🫧</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Tap accuracy
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the bubble to pop it!
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
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#0EA5E9',
    shadowColor: '#0EA5E9',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  bubbleEmoji: {
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

export default PopTheBubbleGame;

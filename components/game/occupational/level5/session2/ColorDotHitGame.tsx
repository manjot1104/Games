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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DOT_SIZE = 60;
const TOLERANCE = 50;

const COLORS = [
  { name: 'Red', emoji: '🔴', color: '#EF4444' },
  { name: 'Blue', emoji: '🔵', color: '#3B82F6' },
  { name: 'Green', emoji: '🟢', color: '#10B981' },
  { name: 'Yellow', emoji: '🟡', color: '#FCD34D' },
  { name: 'Purple', emoji: '🟣', color: '#8B5CF6' },
];

interface Dot {
  id: string;
  x: number;
  y: number;
  colorIndex: number;
  scale: number;
}

const ColorDotHitGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [dots, setDots] = useState<Dot[]>([]);
  const [targetColorIndex, setTargetColorIndex] = useState<number | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const hasSpokenRef = useRef(false);

  const generateDots = useCallback(() => {
    const newDots: Dot[] = [];
    const targetIdx = Math.floor(Math.random() * COLORS.length);
    setTargetColorIndex(targetIdx);

    // Generate 3-4 dots with different colors
    const dotCount = 3 + Math.floor(Math.random() * 2);
    const usedIndices = new Set<number>();
    usedIndices.add(targetIdx);

    for (let i = 0; i < dotCount; i++) {
      let colorIdx;
      do {
        colorIdx = Math.floor(Math.random() * COLORS.length);
      } while (usedIndices.has(colorIdx) && usedIndices.size < COLORS.length);
      usedIndices.add(colorIdx);

      newDots.push({
        id: `dot-${i}`,
        x: Math.random() * (screenWidth.current - DOT_SIZE) + DOT_SIZE / 2,
        y: Math.random() * (screenHeight.current - DOT_SIZE - 200) + DOT_SIZE / 2 + 100,
        colorIndex: colorIdx,
        scale: 1,
      });
    }

    setDots(newDots);
  }, []);

  const handleDotTap = useCallback((dotId: string, dotColorIndex: number) => {
    if (done || targetColorIndex === null || dots.length === 0) return;
    
    const isCorrect = dotColorIndex === targetColorIndex;
    
    if (isCorrect) {
      setDots((prev) => prev.map((d) => 
        d.id === dotId ? { ...d, scale: 1.5 } : d
      ));
      setTimeout(() => {
        setDots((prev) => prev.map((d) => 
          d.id === dotId ? { ...d, scale: 1 } : d
        ));
      }, 200);

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            generateDots();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS(`Correct! ${COLORS[targetColorIndex].name}!`, 0.9, 'en-US' );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try the correct color!', 0.8, 'en-US' );
    }
  }, [done, dots, targetColorIndex, generateDots]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'color-dot-hit',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-discrimination', 'color-recognition', 'attention'],
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
      generateDots();
      setTimeout(() => {
        if (targetColorIndex !== null && !hasSpokenRef.current) {
          hasSpokenRef.current = true;
          speakTTS(`Tap the ${COLORS[targetColorIndex].name.toLowerCase()} dot!`, 0.8, 'en-US' );
        }
      }, 500);
    }
  }, [showInfo, round, done, generateDots, targetColorIndex]);

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
        title="Color Dot Hit"
        emoji="🎨"
        description="Tap the correct color dot! Build your visual discrimination skills."
        skills={['Visual discrimination']}
        suitableFor="Children learning color recognition and visual discrimination"
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
            generateDots();
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
        <Text style={styles.title}>Color Dot Hit</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {targetColorIndex !== null && `Tap the ${COLORS[targetColorIndex].name.toLowerCase()} dot!`}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {dots.map((dot) => (
          <Pressable
            key={dot.id}
            onPress={() => handleDotTap(dot.id, dot.colorIndex)}
            style={[
              styles.dot,
              {
                left: dot.x - DOT_SIZE / 2,
                top: dot.y - DOT_SIZE / 2,
                backgroundColor: COLORS[dot.colorIndex].color,
                transform: [{ scale: dot.scale }],
                borderWidth: dot.colorIndex === targetColorIndex ? 4 : 2,
                borderColor: dot.colorIndex === targetColorIndex ? '#000' : '#fff',
              },
            ]}
          >
            <Text style={styles.dotEmoji}>{COLORS[dot.colorIndex].emoji}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual discrimination
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the correct color dot!
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
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  dotEmoji: {
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

export default ColorDotHitGame;

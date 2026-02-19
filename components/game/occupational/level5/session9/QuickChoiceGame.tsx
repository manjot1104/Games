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
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OPTION_SIZE = 100;
const TOLERANCE = 60;
const TIME_LIMIT = 2000; // 2 seconds

const OPTIONS = [
  { emoji: '🍎', name: 'Apple' },
  { emoji: '🍌', name: 'Banana' },
  { emoji: '🍊', name: 'Orange' },
  { emoji: '🍇', name: 'Grape' },
  { emoji: '🍓', name: 'Strawberry' },
  { emoji: '🥝', name: 'Kiwi' },
];

interface ChoiceOption {
  id: string;
  x: number;
  y: number;
  emoji: string;
  name: string;
  isCorrect: boolean;
  scale: number;
}

const QuickChoiceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [options, setOptions] = useState<ChoiceOption[]>([]);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generateOptions = useCallback(() => {
    const correctOption = OPTIONS[Math.floor(Math.random() * OPTIONS.length)];
    const wrongOption = OPTIONS.find(o => o.name !== correctOption.name)!;
    
    const newOptions: ChoiceOption[] = [
      {
        id: 'correct',
        x: screenWidth.current * 0.3,
        y: screenHeight.current * 0.5,
        emoji: correctOption.emoji,
        name: correctOption.name,
        isCorrect: true,
        scale: 1,
      },
      {
        id: 'wrong',
        x: screenWidth.current * 0.7,
        y: screenHeight.current * 0.5,
        emoji: wrongOption.emoji,
        name: wrongOption.name,
        isCorrect: false,
        scale: 1,
      },
    ];

    // Shuffle positions
    if (Math.random() > 0.5) {
      newOptions[0].x = screenWidth.current * 0.7;
      newOptions[1].x = screenWidth.current * 0.3;
    }

    setOptions(newOptions);
    setTimeLeft(TIME_LIMIT);

    // Start countdown
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    let remaining = TIME_LIMIT;
    timerRef.current = setInterval(() => {
      remaining -= 100;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        // Time's up - move to next round
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            generateOptions();
          } else {
            endGame(score);
          }
        }, 1000);
      }
    }, 100);
  }, [round, score]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || options.length === 0 || timeLeft <= 0) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    for (const option of options) {
      const distance = Math.sqrt(
        Math.pow(tapX - option.x, 2) + Math.pow(tapY - option.y, 2)
      );

      if (distance <= TOLERANCE + OPTION_SIZE / 2) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        if (option.isCorrect) {
          setOptions((prev) => prev.map((o) => 
            o.id === option.id ? { ...o, scale: 1.3 } : o
          ));
          setTimeout(() => {
            setOptions((prev) => prev.map((o) => 
              o.id === option.id ? { ...o, scale: 1 } : o
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
                generateOptions();
              }, 1500);
            }
            return newScore;
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Quick choice!', 0.9, 'en-US' );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS('Choose the correct one!', 0.8, 'en-US' );
        }
        return;
      }
    }
  }, [done, options, timeLeft, generateOptions]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'quick-choice',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['decision-speed', 'quick-thinking', 'choice-making'],
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
      generateOptions();
      setTimeout(() => {
        speakTTS('Choose quickly!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, done, generateOptions]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Quick Choice"
        emoji="⚡"
        description="Choose quickly between 2 options! Build decision speed."
        skills={['Decision speed']}
        suitableFor="Children learning quick decision making"
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
            generateOptions();
          }}
        />
      </SafeAreaView>
    );
  }

  const timePercent = (timeLeft / TIME_LIMIT) * 100;

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
        <Text style={styles.title}>Quick Choice</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <View style={styles.timerContainer}>
          <View style={styles.timerBar}>
            <View style={[styles.timerFill, { width: `${timePercent}%` }]} />
          </View>
          <Text style={styles.timerText}>
            {(timeLeft / 1000).toFixed(1)}s
          </Text>
        </View>
        <Text style={styles.instruction}>
          Choose quickly!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        {options.map((option) => (
          <View
            key={option.id}
            style={[
              styles.option,
              {
                left: option.x - OPTION_SIZE / 2,
                top: option.y - OPTION_SIZE / 2,
                backgroundColor: option.isCorrect ? '#10B981' : '#EF4444',
                transform: [{ scale: option.scale }],
                borderWidth: option.isCorrect ? 4 : 2,
                borderColor: option.isCorrect ? '#000' : '#fff',
              },
            ]}
          >
            <Text style={styles.optionEmoji}>{option.emoji}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Decision speed
        </Text>
        <Text style={styles.footerSubtext}>
          Choose quickly between 2 options!
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
  timerContainer: {
    width: '80%',
    marginBottom: 12,
  },
  timerBar: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  timerFill: {
    height: '100%',
    backgroundColor: '#EF4444',
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EF4444',
    textAlign: 'center',
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
  option: {
    position: 'absolute',
    width: OPTION_SIZE,
    height: OPTION_SIZE,
    borderRadius: OPTION_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  optionEmoji: {
    fontSize: 50,
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

export default QuickChoiceGame;

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
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 70;
const TOLERANCE = 50;
const FLASH_DURATION = 1500; // 1.5 seconds

const OBJECTS = ['🔴', '🔵', '🟢', '🟡', '🟣', '⭐', '💎', '🎈', '🎁', '🎀'];

interface FlashObject {
  id: string;
  x: number;
  y: number;
  emoji: string;
}

const MemoryFlashGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [flashObject, setFlashObject] = useState<FlashObject | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const [choices, setChoices] = useState<FlashObject[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const endGameRef = useRef<(score: number) => Promise<void>>();

  const generateRound = useCallback(() => {
    const targetEmoji = OBJECTS[Math.floor(Math.random() * OBJECTS.length)];
    const targetX = Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2;
    const targetY = Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100;

    const flashObj: FlashObject = {
      id: 'flash-1',
      x: targetX,
      y: targetY,
      emoji: targetEmoji,
    };

    setFlashObject(flashObj);
    setShowFlash(true);
    setShowChoices(false);

    // Hide flash after duration
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      setShowFlash(false);
      
      // Generate choices (1 correct + 2 wrong)
      const wrongObjects = OBJECTS.filter(e => e !== targetEmoji);
      const wrongChoices = [];
      for (let i = 0; i < 2; i++) {
        const wrongEmoji = wrongObjects[Math.floor(Math.random() * wrongObjects.length)];
        wrongChoices.push({
          id: `choice-${i}`,
          x: Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2,
          y: Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100,
          emoji: wrongEmoji,
        });
      }

      const allChoices = [
        flashObj,
        ...wrongChoices,
      ];

      // Shuffle
      for (let i = allChoices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
      }

      setChoices(allChoices);
      setShowChoices(true);
      speakTTS('Which object flashed?', 0.8, 'en-US' );
    }, FLASH_DURATION);
  }, []);

  const handleChoiceTap = useCallback((choice: FlashObject) => {
    if (done || !showChoices || !flashObject) return;
    
    const isCorrect = choice.emoji === flashObject.emoji;
    
    if (isCorrect) {
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            if (endGameRef.current) {
              endGameRef.current(newScore);
            }
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            generateRound();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Correct!', 0.9, 'en-US' );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try again!', 0.8, 'en-US' );
    }
  }, [done, showChoices, flashObject, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'memory-flash',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-memory', 'attention', 'recall'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  // Store endGame in ref to avoid closure issues
  useEffect(() => {
    endGameRef.current = endGame;
  }, [endGame]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      generateRound();
      setTimeout(() => {
        speakTTS('Watch the object flash!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, generateRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Memory Flash"
        emoji="💫"
        description="Watch the object flash, then find it! Build your visual memory."
        skills={['Visual memory']}
        suitableFor="Children learning visual memory and recall skills"
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
            generateRound();
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
        <Text style={styles.title}>Memory Flash</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💫 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showFlash ? 'Watch the object flash!' : showChoices ? 'Which object flashed?' : 'Get ready...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        pointerEvents="box-none"
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {showFlash && flashObject && (
          <View
            style={[
              styles.flashObject,
              {
                left: flashObject.x - OBJECT_SIZE / 2,
                top: flashObject.y - OBJECT_SIZE / 2,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{flashObject.emoji}</Text>
          </View>
        )}

        {showChoices && choices.map((choice) => (
          <TouchableOpacity
            key={choice.id}
            activeOpacity={0.7}
            onPress={() => handleChoiceTap(choice)}
            style={[
              styles.choiceObject,
              {
                left: choice.x - OBJECT_SIZE / 2,
                top: choice.y - OBJECT_SIZE / 2,
                zIndex: 10,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{choice.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual memory
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the object flash, then find it!
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
  flashObject: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.6,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  choiceObject: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  objectEmoji: {
    fontSize: 35,
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

export default MemoryFlashGame;

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

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 50;
const TOLERANCE = 50;
const PATTERN_LENGTH = 4;

const PATTERNS = [
  ['🔴', '🔵', '🟢', '🟡'],
  ['⭐', '💎', '🎈', '🎁'],
  ['🔴', '🔴', '🔵', '🔵'],
  ['🟢', '🟡', '🟢', '🟡'],
];

interface PatternObject {
  id: string;
  x: number;
  y: number;
  emoji: string;
  index: number;
  scale: number;
}

const PatternChaseGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [pattern, setPattern] = useState<string[]>([]);
  const [objects, setObjects] = useState<PatternObject[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showPattern, setShowPattern] = useState(true);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const patternTimerRef = useRef<NodeJS.Timeout | null>(null);

  const generateRound = useCallback(() => {
    const selectedPattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    setPattern(selectedPattern);
    setCurrentIndex(0);
    setShowPattern(true);

    // Show pattern sequence
    if (patternTimerRef.current) {
      clearTimeout(patternTimerRef.current);
    }

    let patternStep = 0;
    const showPatternStep = () => {
      if (patternStep < selectedPattern.length) {
        const newObjects: PatternObject[] = [];
        for (let i = 0; i <= patternStep; i++) {
          newObjects.push({
            id: `pattern-${i}`,
            x: (screenWidth.current / (selectedPattern.length + 1)) * (i + 1),
            y: screenHeight.current * 0.3,
            emoji: selectedPattern[i],
            index: i,
            scale: 1,
          });
        }
        setObjects(newObjects);
        patternStep++;
        patternTimerRef.current = setTimeout(showPatternStep, 800);
      } else {
        // Hide pattern and show choices
        setTimeout(() => {
          setShowPattern(false);
          const choiceObjects: PatternObject[] = [];
          const allEmojis = [...new Set(PATTERNS.flat())];
          
          for (let i = 0; i < selectedPattern.length; i++) {
            const correctEmoji = selectedPattern[i];
            const wrongEmojis = allEmojis.filter(e => e !== correctEmoji);
            const wrongEmoji = wrongEmojis[Math.floor(Math.random() * wrongEmojis.length)];
            
            // Show 2 options per position
            choiceObjects.push({
              id: `choice-${i}-correct`,
              x: (screenWidth.current / (selectedPattern.length + 1)) * (i + 1) - 30,
              y: screenHeight.current * 0.6,
              emoji: correctEmoji,
              index: i,
              scale: 1,
            });
            choiceObjects.push({
              id: `choice-${i}-wrong`,
              x: (screenWidth.current / (selectedPattern.length + 1)) * (i + 1) + 30,
              y: screenHeight.current * 0.6,
              emoji: wrongEmoji,
              index: i,
              scale: 1,
            });
          }
          setObjects(choiceObjects);
          setCurrentIndex(0);
          speakTTS('Follow the pattern!', 0.8, 'en-US' );
        }, 1000);
      }
    };
    showPatternStep();
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || showPattern || objects.length === 0 || pattern.length === 0) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    for (const obj of objects) {
      const distance = Math.sqrt(
        Math.pow(tapX - obj.x, 2) + Math.pow(tapY - obj.y, 2)
      );

      if (distance <= TOLERANCE + OBJECT_SIZE / 2) {
        const isCorrect = obj.emoji === pattern[currentIndex] && obj.id.includes('correct');
        
        if (isCorrect) {
          setObjects((prev) => prev.map((o) => 
            o.id === obj.id ? { ...o, scale: 1.5 } : o
          ));
          setTimeout(() => {
            setObjects((prev) => prev.map((o) => 
              o.id === obj.id ? { ...o, scale: 1 } : o
            ));
          }, 200);

          if (currentIndex < pattern.length - 1) {
            setCurrentIndex((prev) => prev + 1);
            speakTTS('Next!', 0.9, 'en-US' );
          } else {
            // Pattern complete
            setScore((s) => {
              const newScore = s + 1;
              if (newScore >= TOTAL_ROUNDS) {
                setTimeout(() => {
                  endGame(newScore);
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
            speakTTS('Pattern complete!', 0.9, 'en-US' );
          }
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS('Follow the pattern!', 0.8, 'en-US' );
        }
        return;
      }
    }
  }, [done, showPattern, objects, pattern, currentIndex, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 18;
    const accuracy = (finalScore / total) * 100;

    if (patternTimerRef.current) {
      clearTimeout(patternTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'pattern-chase',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-memory', 'pattern-recognition', 'sequence-following'],
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
      generateRound();
      setTimeout(() => {
        speakTTS('Watch the pattern!', 0.8, 'en-US' );
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
      if (patternTimerRef.current) {
        clearTimeout(patternTimerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pattern Chase"
        emoji="🔢"
        description="Watch the pattern, then follow it! Build visual memory."
        skills={['Visual memory']}
        suitableFor="Children learning pattern recognition and visual memory"
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
        <Text style={styles.title}>Pattern Chase</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔢 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showPattern ? 'Watch the pattern...' : `Follow step ${currentIndex + 1} of ${pattern.length}`}
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
        {objects.map((obj) => (
          <View
            key={obj.id}
            style={[
              styles.object,
              {
                left: obj.x - OBJECT_SIZE / 2,
                top: obj.y - OBJECT_SIZE / 2,
                transform: [{ scale: obj.scale }],
                opacity: showPattern ? 1 : (obj.id.includes('correct') && obj.index === currentIndex ? 1 : obj.index < currentIndex ? 0.5 : 0.3),
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{obj.emoji}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual memory
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the pattern, then follow it!
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
  object: {
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

export default PatternChaseGame;

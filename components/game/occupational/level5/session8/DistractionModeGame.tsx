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
const TARGET_SIZE = 60;
const DISTRACTION_SIZE = 50;
const TOLERANCE = 50;
const DISTRACTION_COUNT = 4;

interface GameObject {
  id: string;
  x: number;
  y: number;
  isTarget: boolean;
  scale: number;
}

const DistractionModeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<GameObject[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const generateObjects = useCallback(() => {
    const newObjects: GameObject[] = [];
    const usedPositions = new Set<string>();
    
    // Create target
    let targetX, targetY;
    do {
      targetX = Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2;
      targetY = Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100;
    } while (usedPositions.has(`${Math.floor(targetX / 50)}-${Math.floor(targetY / 50)}`));
    usedPositions.add(`${Math.floor(targetX / 50)}-${Math.floor(targetY / 50)}`);
    
    newObjects.push({
      id: 'target',
      x: targetX,
      y: targetY,
      isTarget: true,
      scale: 1,
    });

    // Create distractions
    for (let i = 0; i < DISTRACTION_COUNT; i++) {
      let distX, distY;
      let attempts = 0;
      do {
        distX = Math.random() * (screenWidth.current - DISTRACTION_SIZE) + DISTRACTION_SIZE / 2;
        distY = Math.random() * (screenHeight.current - DISTRACTION_SIZE - 200) + DISTRACTION_SIZE / 2 + 100;
        attempts++;
      } while (usedPositions.has(`${Math.floor(distX / 50)}-${Math.floor(distY / 50)}`) && attempts < 20);
      
      usedPositions.add(`${Math.floor(distX / 50)}-${Math.floor(distY / 50)}`);
      
      newObjects.push({
        id: `distraction-${i}`,
        x: distX,
        y: distY,
        isTarget: false,
        scale: 1,
      });
    }

    setObjects(newObjects);
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || objects.length === 0) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    for (const obj of objects) {
      const size = obj.isTarget ? TARGET_SIZE : DISTRACTION_SIZE;
      const distance = Math.sqrt(
        Math.pow(tapX - obj.x, 2) + Math.pow(tapY - obj.y, 2)
      );

      if (distance <= TOLERANCE + size / 2) {
        if (obj.isTarget) {
          // Success!
          setObjects((prev) => prev.map((o) => 
            o.id === obj.id ? { ...o, scale: 1.5 } : o
          ));
          setTimeout(() => {
            setObjects((prev) => prev.map((o) => 
              o.id === obj.id ? { ...o, scale: 1 } : o
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
                generateObjects();
              }, 1500);
            }
            return newScore;
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Focus maintained!', 0.9, 'en-US' );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS('Focus on the target!', 0.8, 'en-US' );
        }
        return;
      }
    }
  }, [done, objects, generateObjects]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'distraction-mode',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['focus-under-load', 'selective-attention', 'distraction-resistance'],
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
      generateObjects();
      setTimeout(() => {
        speakTTS('Tap the target, ignore distractions!', { rate: 0.8, language: 'en-US' });
      }, 500);
    }
  }, [showInfo, round, done, generateObjects]);

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
        title="Distraction Mode"
        emoji="🎯"
        description="Tap the target while ignoring extra objects! Build focus under load."
        skills={['Focus under load']}
        suitableFor="Children learning to maintain focus with distractions"
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
            generateObjects();
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
        <Text style={styles.title}>Distraction Mode</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the target, ignore distractions!
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
        {objects.map((obj) => {
          const size = obj.isTarget ? TARGET_SIZE : DISTRACTION_SIZE;
          return (
            <View
              key={obj.id}
              style={[
                styles.object,
                {
                  left: obj.x - size / 2,
                  top: obj.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: obj.isTarget ? '#10B981' : '#E2E8F0',
                  borderWidth: obj.isTarget ? 4 : 2,
                  borderColor: obj.isTarget ? '#000' : '#94A3B8',
                  transform: [{ scale: obj.scale }],
                },
              ]}
            >
              <Text style={[styles.objectEmoji, { fontSize: size * 0.5 }]}>
                {obj.isTarget ? '🎯' : '⚪'}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Focus under load
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the target, ignore distractions!
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
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  objectEmoji: {
    // fontSize set dynamically
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

export default DistractionModeGame;

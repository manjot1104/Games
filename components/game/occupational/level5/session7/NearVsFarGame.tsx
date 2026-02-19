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
const NEAR_SIZE = 80;
const FAR_SIZE = 40;
const TOLERANCE = 50;

interface Target {
  id: string;
  x: number;
  y: number;
  isNear: boolean;
  scale: number;
}

const NearVsFarGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetNear, setTargetNear] = useState(true);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const generateTargets = useCallback(() => {
    const isNear = Math.random() > 0.5;
    setTargetNear(isNear);

    const newTargets: Target[] = [];
    
    // Create near target (big)
    newTargets.push({
      id: 'near',
      x: Math.random() * (screenWidth.current - NEAR_SIZE) + NEAR_SIZE / 2,
      y: Math.random() * (screenHeight.current - NEAR_SIZE - 200) + NEAR_SIZE / 2 + 100,
      isNear: true,
      scale: 1,
    });

    // Create far target (small)
    newTargets.push({
      id: 'far',
      x: Math.random() * (screenWidth.current - FAR_SIZE) + FAR_SIZE / 2,
      y: Math.random() * (screenHeight.current - FAR_SIZE - 200) + FAR_SIZE / 2 + 100,
      isNear: false,
      scale: 1,
    });

    setTargets(newTargets);
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || targets.length === 0) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    for (const target of targets) {
      const size = target.isNear ? NEAR_SIZE : FAR_SIZE;
      const distance = Math.sqrt(
        Math.pow(tapX - target.x, 2) + Math.pow(tapY - target.y, 2)
      );

      if (distance <= TOLERANCE + size / 2) {
        const isCorrect = target.isNear === targetNear;
        
        if (isCorrect) {
          setTargets((prev) => prev.map((t) => 
            t.id === target.id ? { ...t, scale: 1.5 } : t
          ));
          setTimeout(() => {
            setTargets((prev) => prev.map((t) => 
              t.id === target.id ? { ...t, scale: 1 } : t
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
                generateTargets();
              }, 1500);
            }
            return newScore;
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Correct!', 0.9, 'en-US' );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS(`Tap the ${targetNear ? 'near' : 'far'} target!`, 0.8, 'en-US' );
        }
        return;
      }
    }
  }, [done, targets, targetNear, generateTargets]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'near-vs-far',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['distance-judgment', 'spatial-awareness', 'size-perception'],
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
      generateTargets();
      setTimeout(() => {
        speakTTS(`Tap the ${targetNear ? 'near' : 'far'} target!`, 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, generateTargets, targetNear]);

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
        title="Near vs Far"
        emoji="📏"
        description="Tap the near target (big) or far target (small)! Build distance judgment."
        skills={['Distance judgment']}
        suitableFor="Children learning distance perception and spatial awareness"
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
            generateTargets();
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
        <Text style={styles.title}>Near vs Far</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 📏 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the {targetNear ? 'near' : 'far'} target!
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
        {targets.map((target) => {
          const size = target.isNear ? NEAR_SIZE : FAR_SIZE;
          return (
            <View
              key={target.id}
              style={[
                styles.target,
                {
                  left: target.x - size / 2,
                  top: target.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: target.isNear ? '#10B981' : '#3B82F6',
                  borderWidth: target.isNear === targetNear ? 4 : 2,
                  borderColor: target.isNear === targetNear ? '#000' : '#fff',
                  transform: [{ scale: target.scale }],
                },
              ]}
            >
              <Text style={[styles.targetEmoji, { fontSize: size * 0.5 }]}>
                {target.isNear ? '📏' : '📐'}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Distance judgment
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the {targetNear ? 'near (big)' : 'far (small)'} target!
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
  target: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  targetEmoji: {
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

export default NearVsFarGame;

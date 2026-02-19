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
const OBJECT_SIZE = 50;
const TOLERANCE = 50;
const OBJECT_COUNT = 4;

interface SpeedObject {
  id: string;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  isFast: boolean;
  scale: number;
}

const SpeedObjectsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<SpeedObject[]>([]);
  const [targetFast, setTargetFast] = useState(true);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const fastSpeed = useRef(3);
  const slowSpeed = useRef(0.8);

  const generateObjects = useCallback(() => {
    const isFast = Math.random() > 0.5;
    setTargetFast(isFast);

    const newObjects: SpeedObject[] = [];
    
    // Create mix of fast and slow objects
    for (let i = 0; i < OBJECT_COUNT; i++) {
      const objIsFast = i < 2; // First 2 are fast, last 2 are slow
      const speed = objIsFast ? fastSpeed.current : slowSpeed.current;
      
      newObjects.push({
        id: `obj-${i}`,
        x: Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2,
        y: Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100,
        directionX: (Math.random() > 0.5 ? 1 : -1) * speed,
        directionY: (Math.random() > 0.5 ? 1 : -1) * speed,
        isFast: objIsFast,
        scale: 1,
      });
    }

    setObjects(newObjects);
  }, []);

  const moveObjects = useCallback(() => {
    const move = () => {
      setObjects((prev) => prev.map((obj) => {
        const speed = obj.isFast ? fastSpeed.current : slowSpeed.current;
        let newX = obj.x + (obj.directionX > 0 ? speed : -speed) * Math.sign(obj.directionX);
        let newY = obj.y + (obj.directionY > 0 ? speed : -speed) * Math.sign(obj.directionY);
        let newDirX = obj.directionX;
        let newDirY = obj.directionY;

        // Bounce off walls
        if (newX <= OBJECT_SIZE / 2 || newX >= screenWidth.current - OBJECT_SIZE / 2) {
          newDirX *= -1;
          newX = Math.max(OBJECT_SIZE / 2, Math.min(screenWidth.current - OBJECT_SIZE / 2, newX));
        }
        if (newY <= OBJECT_SIZE / 2 + 100 || newY >= screenHeight.current - OBJECT_SIZE / 2 - 100) {
          newDirY *= -1;
          newY = Math.max(OBJECT_SIZE / 2 + 100, Math.min(screenHeight.current - OBJECT_SIZE / 2 - 100, newY));
        }

        return {
          ...obj,
          x: newX,
          y: newY,
          directionX: newDirX,
          directionY: newDirY,
        };
      }));
    };

    const interval = setInterval(move, 16);
    animationRef.current = interval as unknown as number;
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || objects.length === 0) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    for (const obj of objects) {
      const distance = Math.sqrt(
        Math.pow(tapX - obj.x, 2) + Math.pow(tapY - obj.y, 2)
      );

      if (distance <= TOLERANCE + OBJECT_SIZE / 2) {
        const isCorrect = obj.isFast === targetFast;
        
        if (isCorrect) {
          if (animationRef.current) {
            clearInterval(animationRef.current);
            animationRef.current = null;
          }

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
          speakTTS('Correct speed!', 0.9, 'en-US' );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS(`Tap the ${targetFast ? 'fast' : 'slow'} object!`, 0.8, 'en-US' );
        }
        return;
      }
    }
  }, [done, objects, targetFast, generateObjects]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'speed-objects',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['tracking-control', 'speed-discrimination', 'multi-object-tracking'],
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
        moveObjects();
        speakTTS(`Tap the ${targetFast ? 'fast' : 'slow'} object!`, 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, generateObjects, moveObjects, targetFast]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Speed Objects"
        emoji="⚡"
        description="Tap the fast or slow object among mixed speeds! Build tracking control."
        skills={['Tracking control']}
        suitableFor="Children learning to track objects at different speeds"
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
        <Text style={styles.title}>Speed Objects</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the {targetFast ? 'fast' : 'slow'} object!
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
                backgroundColor: obj.isFast ? '#EF4444' : '#10B981',
                transform: [{ scale: obj.scale }],
                borderWidth: obj.isFast === targetFast ? 4 : 2,
                borderColor: obj.isFast === targetFast ? '#000' : '#fff',
              },
            ]}
          >
            <Text style={styles.objectEmoji}>
              {obj.isFast ? '⚡' : '🐢'}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Tracking control
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the {targetFast ? 'fast' : 'slow'} object!
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
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
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

export default SpeedObjectsGame;

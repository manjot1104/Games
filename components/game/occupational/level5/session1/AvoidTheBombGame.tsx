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
const TARGET_SIZE = 60;
const BOMB_SIZE = 50;
const TOLERANCE = 50;
const BOMB_COUNT = 3;

interface Target {
  id: string;
  x: number;
  y: number;
  scale: number;
}

interface Bomb {
  id: string;
  x: number;
  y: number;
  scale: number;
}

const AvoidTheBombGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [targets, setTargets] = useState<Target[]>([]);
  const [bombs, setBombs] = useState<Bomb[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);

  const generatePositions = useCallback(() => {
    const newTargets: Target[] = [];
    const newBombs: Bomb[] = [];
    
    // Generate one target
    const targetX = Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2;
    const targetY = Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100;
    newTargets.push({
      id: 'target-1',
      x: targetX,
      y: targetY,
      scale: 1,
    });

    // Generate bombs (avoiding target area)
    for (let i = 0; i < BOMB_COUNT; i++) {
      let bombX, bombY;
      let attempts = 0;
      do {
        bombX = Math.random() * (screenWidth.current - BOMB_SIZE) + BOMB_SIZE / 2;
        bombY = Math.random() * (screenHeight.current - BOMB_SIZE - 200) + BOMB_SIZE / 2 + 100;
        attempts++;
      } while (
        Math.sqrt(Math.pow(bombX - targetX, 2) + Math.pow(bombY - targetY, 2)) < 150 &&
        attempts < 20
      );
      
      newBombs.push({
        id: `bomb-${i}`,
        x: bombX,
        y: bombY,
        scale: 1,
      });
    }

    setTargets(newTargets);
    setBombs(newBombs);
  }, []);

  const moveObjects = useCallback(() => {
    const move = () => {
      setTargets((prev) => prev.map((target) => {
        const newX = target.x + (Math.random() - 0.5) * 2;
        const newY = target.y + (Math.random() - 0.5) * 2;
        return {
          ...target,
          x: Math.max(TARGET_SIZE / 2, Math.min(screenWidth.current - TARGET_SIZE / 2, newX)),
          y: Math.max(TARGET_SIZE / 2 + 100, Math.min(screenHeight.current - TARGET_SIZE / 2 - 100, newY)),
        };
      }));

      setBombs((prev) => prev.map((bomb) => {
        const newX = bomb.x + (Math.random() - 0.5) * 3;
        const newY = bomb.y + (Math.random() - 0.5) * 3;
        return {
          ...bomb,
          x: Math.max(BOMB_SIZE / 2, Math.min(screenWidth.current - BOMB_SIZE / 2, newX)),
          y: Math.max(BOMB_SIZE / 2 + 100, Math.min(screenHeight.current - BOMB_SIZE / 2 - 100, newY)),
        };
      }));
    };

    const interval = setInterval(move, 50);
    animationRef.current = interval as unknown as number;
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    // Check if tapped a bomb
    for (const bomb of bombs) {
      const distance = Math.sqrt(
        Math.pow(tapX - bomb.x, 2) + Math.pow(tapY - bomb.y, 2)
      );
      if (distance <= TOLERANCE + BOMB_SIZE / 2) {
        // Hit a bomb!
        setBombs((prev) => prev.map((b) => 
          b.id === bomb.id ? { ...b, scale: 1.5 } : b
        ));
        setTimeout(() => {
          setBombs((prev) => prev.map((b) => 
            b.id === bomb.id ? { ...b, scale: 1 } : b
          ));
        }, 200);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Avoid the bombs!', 0.8, 'en-US' );
        return;
      }
    }

    // Check if tapped a target
    for (const target of targets) {
      const distance = Math.sqrt(
        Math.pow(tapX - target.x, 2) + Math.pow(tapY - target.y, 2)
      );
      if (distance <= TOLERANCE + TARGET_SIZE / 2) {
        // Success!
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
              generatePositions();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Great focus!', 0.9, 'en-US' );
        return;
      }
    }
  }, [done, targets, bombs]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'avoid-the-bomb',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['focus', 'control', 'selective-attention'],
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
      generatePositions();
      setTimeout(() => {
        moveObjects();
        speakTTS('Tap targets, avoid bombs!', { rate: 0.8, language: 'en-US' });
      }, 500);
    }
  }, [showInfo, round, done, generatePositions, moveObjects]);

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
        title="Avoid the Bomb"
        emoji="💣"
        description="Tap the targets while avoiding the bombs!"
        skills={['Focus', 'Control']}
        suitableFor="Children learning focus and control"
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
            generatePositions();
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
        <Text style={styles.title}>Avoid the Bomb</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap targets, avoid bombs!
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
        {targets.map((target) => (
          <View
            key={target.id}
            style={[
              styles.target,
              {
                left: target.x - TARGET_SIZE / 2,
                top: target.y - TARGET_SIZE / 2,
                transform: [{ scale: target.scale }],
              },
            ]}
          >
            <Text style={styles.targetEmoji}>🎯</Text>
          </View>
        ))}
        {bombs.map((bomb) => (
          <View
            key={bomb.id}
            style={[
              styles.bomb,
              {
                left: bomb.x - BOMB_SIZE / 2,
                top: bomb.y - BOMB_SIZE / 2,
                transform: [{ scale: bomb.scale }],
              },
            ]}
          >
            <Text style={styles.bombEmoji}>💣</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Focus • Control
        </Text>
        <Text style={styles.footerSubtext}>
          Tap targets while avoiding bombs!
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
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#059669',
    zIndex: 2,
  },
  targetEmoji: {
    fontSize: 35,
  },
  bomb: {
    position: 'absolute',
    width: BOMB_SIZE,
    height: BOMB_SIZE,
    borderRadius: BOMB_SIZE / 2,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#DC2626',
    zIndex: 1,
  },
  bombEmoji: {
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

export default AvoidTheBombGame;

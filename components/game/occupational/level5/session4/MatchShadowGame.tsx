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
const OBJECT_SIZE = 60;
const SHADOW_SIZE = 60;
const TOLERANCE = 50;

const OBJECTS = [
  { emoji: '🐱', shadow: '⬛' },
  { emoji: '🐶', shadow: '⬛' },
  { emoji: '🐰', shadow: '⬛' },
  { emoji: '🐻', shadow: '⬛' },
  { emoji: '🐸', shadow: '⬛' },
  { emoji: '🦁', shadow: '⬛' },
];

interface GameObject {
  id: string;
  x: number;
  y: number;
  emoji: string;
  isShadow: boolean;
  matched: boolean;
}

const MatchShadowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<GameObject | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const endGameRef = useRef<(score: number) => Promise<void>>();

  const generateRound = useCallback(() => {
    const selectedObj = OBJECTS[Math.floor(Math.random() * OBJECTS.length)];
    const newObjects: GameObject[] = [];

    // Create object
    newObjects.push({
      id: 'obj-1',
      x: Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2,
      y: Math.random() * (screenHeight.current / 2 - OBJECT_SIZE - 100) + OBJECT_SIZE / 2 + 100,
      emoji: selectedObj.emoji,
      isShadow: false,
      matched: false,
    });

    // Create correct shadow
    newObjects.push({
      id: 'shadow-correct',
      x: Math.random() * (screenWidth.current - SHADOW_SIZE) + SHADOW_SIZE / 2,
      y: screenHeight.current / 2 + Math.random() * (screenHeight.current / 2 - SHADOW_SIZE - 100) + SHADOW_SIZE / 2,
      emoji: selectedObj.shadow,
      isShadow: true,
      matched: false,
    });

    // Create wrong shadows
    const wrongObjects = OBJECTS.filter(o => o.emoji !== selectedObj.emoji);
    for (let i = 0; i < 2; i++) {
      const wrongObj = wrongObjects[Math.floor(Math.random() * wrongObjects.length)];
      newObjects.push({
        id: `shadow-wrong-${i}`,
        x: Math.random() * (screenWidth.current - SHADOW_SIZE) + SHADOW_SIZE / 2,
        y: screenHeight.current / 2 + Math.random() * (screenHeight.current / 2 - SHADOW_SIZE - 100) + SHADOW_SIZE / 2,
        emoji: wrongObj.shadow,
        isShadow: true,
        matched: false,
      });
    }

    // Shuffle shadows
    const shadows = newObjects.filter(o => o.isShadow);
    const object = newObjects.find(o => !o.isShadow)!;
    for (let i = shadows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shadows[i], shadows[j]] = [shadows[j], shadows[i]];
    }

    setObjects([object, ...shadows]);
    setSelectedObject(null);
  }, []);

  const handleObjectTap = useCallback((obj: GameObject) => {
    if (done || obj.matched) return;
    
    if (!obj.isShadow) {
      // Selected the object
      setSelectedObject(obj);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else if (selectedObject) {
      // Selected a shadow - check if it matches
      const object = objects.find(o => !o.isShadow && !o.matched);
      if (object) {
        // Check if this is the correct shadow
        const isCorrect = obj.id === 'shadow-correct';
        
        if (isCorrect) {
          setObjects((prev) => prev.map((o) => 
            (o.id === object.id || o.id === obj.id) ? { ...o, matched: true } : o
          ));
          
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
          speakTTS('Perfect match!', 0.9, 'en-US' );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS('Try again!', 0.8, 'en-US' );
        }
        setSelectedObject(null);
      }
    }
  }, [done, objects, selectedObject, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'match-shadow',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['depth-perception', 'visual-matching', 'spatial-awareness'],
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
        speakTTS('Match the object with its shadow!', 0.8, 'en-US' );
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
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Match Shadow"
        emoji="🕳️"
        description="Match the object with its shadow! Build depth perception."
        skills={['Depth perception']}
        suitableFor="Children learning visual matching and depth perception"
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
        <Text style={styles.title}>Match Shadow</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🕳️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Match the object with its shadow!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {objects.map((obj) => (
          <TouchableOpacity
            key={obj.id}
            activeOpacity={0.7}
            onPress={() => handleObjectTap(obj)}
            disabled={obj.matched}
            style={[
              styles.object,
              obj.isShadow ? styles.shadow : styles.regularObject,
              {
                left: obj.x - (obj.isShadow ? SHADOW_SIZE : OBJECT_SIZE) / 2,
                top: obj.y - (obj.isShadow ? SHADOW_SIZE : OBJECT_SIZE) / 2,
                width: obj.isShadow ? SHADOW_SIZE : OBJECT_SIZE,
                height: obj.isShadow ? SHADOW_SIZE : OBJECT_SIZE,
                opacity: obj.matched ? 0.3 : 1,
                borderColor: selectedObject && !obj.isShadow && obj.id === selectedObject.id ? '#3B82F6' : '#E2E8F0',
                borderWidth: selectedObject && !obj.isShadow && obj.id === selectedObject.id ? 4 : 2,
                zIndex: obj.matched ? 1 : 10,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{obj.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Depth perception
        </Text>
        <Text style={styles.footerSubtext}>
          Match the object with its shadow!
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
    width: '100%',
    height: '100%',
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
  regularObject: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#FFFFFF',
  },
  shadow: {
    width: SHADOW_SIZE,
    height: SHADOW_SIZE,
    borderRadius: SHADOW_SIZE / 2,
    backgroundColor: '#1F2937',
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

export default MatchShadowGame;

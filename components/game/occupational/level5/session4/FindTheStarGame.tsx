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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 50;
const TOLERANCE = 50;
const OBJECT_COUNT = 8;

const OBJECTS = ['⭐', '🔴', '🔵', '🟢', '🟡', '🟣', '⚫', '⚪', '🔶', '🔷', '💎', '🎈'];

interface GameObject {
  id: string;
  x: number;
  y: number;
  emoji: string;
  isStar: boolean;
  scale: number;
}

const FindTheStarGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<GameObject[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const endGameRef = useRef<((finalScore: number) => Promise<void>) | null>(null);

  const generateObjects = useCallback(() => {
    const newObjects: GameObject[] = [];
    const usedPositions = new Set<string>();
    
    // Generate one star
    let starX, starY;
    do {
      starX = Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2;
      starY = Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100;
    } while (usedPositions.has(`${Math.floor(starX / 50)}-${Math.floor(starY / 50)}`));
    usedPositions.add(`${Math.floor(starX / 50)}-${Math.floor(starY / 50)}`);
    
    newObjects.push({
      id: 'star-1',
      x: starX,
      y: starY,
      emoji: '⭐',
      isStar: true,
      scale: 1,
    });

    // Generate other objects
    const otherObjects = OBJECTS.filter(e => e !== '⭐');
    for (let i = 0; i < OBJECT_COUNT - 1; i++) {
      let objX, objY;
      let attempts = 0;
      do {
        objX = Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2;
        objY = Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100;
        attempts++;
      } while (usedPositions.has(`${Math.floor(objX / 50)}-${Math.floor(objY / 50)}`) && attempts < 20);
      
      usedPositions.add(`${Math.floor(objX / 50)}-${Math.floor(objY / 50)}`);
      
      newObjects.push({
        id: `obj-${i}`,
        x: objX,
        y: objY,
        emoji: otherObjects[Math.floor(Math.random() * otherObjects.length)],
        isStar: false,
        scale: 1,
      });
    }

    // Shuffle array
    for (let i = newObjects.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newObjects[i], newObjects[j]] = [newObjects[j], newObjects[i]];
    }

    setObjects(newObjects);
  }, []);

  const handleObjectTap = useCallback((obj: { id: string; isStar: boolean }) => {
    if (done) return;
    
    if (obj.isStar) {
      // Found the star!
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
            if (endGameRef.current) {
              endGameRef.current(newScore);
            }
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
      speakTTS('Star found!', 0.9, 'en-US' );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Find the star!', 0.8, 'en-US' );
    }
  }, [done, generateObjects]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'find-the-star',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-scanning', 'attention', 'object-recognition'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    endGameRef.current = endGame;
  }, [endGame]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      generateObjects();
      setTimeout(() => {
        speakTTS('Find the star among all objects!', 0.8, 'en-US' );
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
        title="Find the Star"
        emoji="⭐"
        description="Find the star among many objects! Build your visual scanning skills."
        skills={['Visual scanning']}
        suitableFor="Children learning visual scanning and attention skills"
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
        <Text style={styles.title}>Find the Star</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⭐ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Find the star among all objects!
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
          <Pressable
            key={obj.id}
            onPress={() => handleObjectTap(obj)}
            style={[
              styles.object,
              {
                left: obj.x - OBJECT_SIZE / 2,
                top: obj.y - OBJECT_SIZE / 2,
                transform: [{ scale: obj.scale }],
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{obj.emoji}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual scanning
        </Text>
        <Text style={styles.footerSubtext}>
          Find the star among all objects!
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
    borderWidth: 2,
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

export default FindTheStarGame;

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
const OBJECT_COUNT = 10;

const COLORS = [
  { name: 'Red', emoji: '🔴', color: '#EF4444' },
  { name: 'Blue', emoji: '🔵', color: '#3B82F6' },
  { name: 'Green', emoji: '🟢', color: '#10B981' },
  { name: 'Yellow', emoji: '🟡', color: '#FCD34D' },
  { name: 'Purple', emoji: '🟣', color: '#8B5CF6' },
  { name: 'Orange', emoji: '🟠', color: '#F97316' },
];

interface ColorObject {
  id: string;
  x: number;
  y: number;
  colorIndex: number;
  scale: number;
  clicked: boolean;
}

const SpotTheColorGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<ColorObject[]>([]);
  const [targetColorIndex, setTargetColorIndex] = useState<number | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const endGameRef = useRef<(score: number) => Promise<void>>();

  const generateRound = useCallback(() => {
    const targetIdx = Math.floor(Math.random() * COLORS.length);
    setTargetColorIndex(targetIdx);

    const newObjects: ColorObject[] = [];
    const usedPositions = new Set<string>();
    
    // Generate objects with mixed colors
    for (let i = 0; i < OBJECT_COUNT; i++) {
      let objX, objY;
      let attempts = 0;
      do {
        objX = Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2;
        objY = Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100;
        attempts++;
      } while (usedPositions.has(`${Math.floor(objX / 50)}-${Math.floor(objY / 50)}`) && attempts < 20);
      
      usedPositions.add(`${Math.floor(objX / 50)}-${Math.floor(objY / 50)}`);
      
      // Mix colors - generate 3-4 target color objects, rest random
      const targetCount = 3 + Math.floor(Math.random() * 2); // 3 or 4 target objects
      const colorIdx = i < targetCount ? targetIdx : Math.floor(Math.random() * COLORS.length);
      
      newObjects.push({
        id: `obj-${i}`,
        x: objX,
        y: objY,
        colorIndex: colorIdx,
        scale: 1,
        clicked: false,
      });
    }

    // Shuffle
    for (let i = newObjects.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newObjects[i], newObjects[j]] = [newObjects[j], newObjects[i]];
    }

    setObjects(newObjects);
  }, []);

  const handleObjectTap = useCallback((obj: ColorObject) => {
    if (done || targetColorIndex === null || obj.clicked) return;
    
    const isCorrect = obj.colorIndex === targetColorIndex;
    
    if (isCorrect) {
      // Mark object as clicked and remove it
      setObjects((prev) => {
        const updated = prev.map((o) => 
          o.id === obj.id ? { ...o, clicked: true } : o
        );
        
        // Check if all target color objects are clicked
        const targetObjects = updated.filter(o => o.colorIndex === targetColorIndex);
        const allClicked = targetObjects.every(o => o.clicked);
        
        if (allClicked) {
          // All target objects clicked, advance round
          setTimeout(() => {
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
          }, 500);
        }
        
        return updated;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS(`Good!`, 0.9, 'en-US' );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Find the correct color!', 0.8, 'en-US' );
    }
  }, [done, targetColorIndex, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'spot-the-color',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['selective-focus', 'color-recognition', 'attention'],
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
        if (targetColorIndex !== null) {
          speakTTS(`Find all ${COLORS[targetColorIndex].name.toLowerCase()} objects!`, 0.8, 'en-US' );
        }
      }, 500);
    }
  }, [showInfo, round, done, generateRound, targetColorIndex]);

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
        title="Spot the Color"
        emoji="🎨"
        description="Find all objects of the specific color! Build selective focus."
        skills={['Selective focus']}
        suitableFor="Children learning selective attention and color recognition"
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
        <Text style={styles.title}>Spot the Color</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {targetColorIndex !== null && `Find all ${COLORS[targetColorIndex].name.toLowerCase()} objects!`}
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
        {objects.filter(obj => !obj.clicked).map((obj) => (
          <TouchableOpacity
            key={obj.id}
            activeOpacity={0.7}
            onPress={() => handleObjectTap(obj)}
            style={[
              styles.object,
              {
                left: obj.x - OBJECT_SIZE / 2,
                top: obj.y - OBJECT_SIZE / 2,
                backgroundColor: COLORS[obj.colorIndex].color,
                transform: [{ scale: obj.scale }],
                borderWidth: obj.colorIndex === targetColorIndex ? 4 : 2,
                borderColor: obj.colorIndex === targetColorIndex ? '#000' : '#fff',
                zIndex: 10,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{COLORS[obj.colorIndex].emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Selective focus
        </Text>
        <Text style={styles.footerSubtext}>
          Find all objects of the specific color!
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
    fontSize: 25,
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

export default SpotTheColorGame;

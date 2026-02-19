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
const OBJECT_SIZE = 60;
const TOLERANCE = 50;
const OBJECT_COUNT = 4;

const OBJECTS = ['🔴', '🔵', '🟢', '🟡', '🟣', '⭐', '💎', '🎈'];

interface GameObject {
  id: string;
  x: number;
  y: number;
  emoji: string;
  initialX: number;
  initialY: number;
  moved: boolean;
}

const WhatMovedGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [showInitial, setShowInitial] = useState(true);
  const [movedObject, setMovedObject] = useState<GameObject | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const changeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const endGameRef = useRef<(score: number) => Promise<void>>();

  const generateRound = useCallback(() => {
    const newObjects: GameObject[] = [];
    const usedPositions = new Set<string>();
    
    for (let i = 0; i < OBJECT_COUNT; i++) {
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
        emoji: OBJECTS[Math.floor(Math.random() * OBJECTS.length)],
        initialX: objX,
        initialY: objY,
        moved: false,
      });
    }

    // Select one to move
    const moveIndex = Math.floor(Math.random() * newObjects.length);
    const movedObj = newObjects[moveIndex];
    movedObj.moved = true;
    
    // Move it to a new position
    let newX, newY;
    do {
      newX = Math.random() * (screenWidth.current - OBJECT_SIZE) + OBJECT_SIZE / 2;
      newY = Math.random() * (screenHeight.current - OBJECT_SIZE - 200) + OBJECT_SIZE / 2 + 100;
    } while (usedPositions.has(`${Math.floor(newX / 50)}-${Math.floor(newY / 50)}`));
    
    movedObj.x = newX;
    movedObj.y = newY;
    setMovedObject(movedObj);

    setObjects(newObjects);
    setShowInitial(true);

    // Show initial positions for 2 seconds, then change
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
    }
    changeTimerRef.current = setTimeout(() => {
      setShowInitial(false);
      speakTTS('Which object moved?', 0.8, 'en-US' );
    }, 2000);
  }, []);

  const handleObjectTap = useCallback((obj: GameObject) => {
    if (done || showInitial || !movedObject) return;
    
    const isCorrect = obj.id === movedObject.id;
    
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
  }, [done, showInitial, movedObject, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'what-moved',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['attention-control', 'visual-tracking', 'change-detection'],
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
        speakTTS('Watch carefully!', 0.8, 'en-US' );
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
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="What Moved?"
        emoji="👀"
        description="Watch the objects, then find which one moved! Build attention control."
        skills={['Attention control']}
        suitableFor="Children learning attention control and change detection"
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
        <Text style={styles.title}>What Moved?</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👀 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showInitial ? 'Watch carefully...' : 'Which object moved?'}
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
        {objects.map((obj) => (
          <TouchableOpacity
            key={obj.id}
            activeOpacity={0.7}
            onPress={() => !showInitial && handleObjectTap(obj)}
            disabled={showInitial}
            style={[
              styles.object,
              {
                left: (showInitial ? obj.initialX : obj.x) - OBJECT_SIZE / 2,
                top: (showInitial ? obj.initialY : obj.y) - OBJECT_SIZE / 2,
                borderColor: obj.moved && !showInitial ? '#EF4444' : '#E2E8F0',
                borderWidth: obj.moved && !showInitial ? 4 : 2,
                zIndex: 10,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>{obj.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Attention control
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the objects, then find which one moved!
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

export default WhatMovedGame;

import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHAPE_DISPLAY_TIME = 3000;
const RESPONSE_TIME = 5000;

type ShapeType = 'circle' | 'line';

const SHAPE_EMOJIS: Record<ShapeType, string> = {
  'circle': '⭕',
  'line': '➖',
};

const ShapePoseGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showShape, setShowShape] = useState(false);
  const [currentShape, setCurrentShape] = useState<ShapeType>('circle');
  const [canCopy, setCanCopy] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const shapeScale = useRef(new Animated.Value(1)).current;
  const shapeOpacity = useRef(new Animated.Value(0)).current;
  const shapeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showShapeOnScreen = useCallback(() => {
    if (done) return;

    const shapes: ShapeType[] = ['circle', 'line'];
    const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
    setCurrentShape(randomShape);
    
    setShowShape(true);
    setCanCopy(false);
    setHasCopied(false);
    shapeOpacity.setValue(0);
    shapeScale.setValue(0.5);
    
    Animated.parallel([
      Animated.spring(shapeScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(shapeOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    const shapeName = randomShape === 'circle' ? 'circle' : 'line';

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(`Make a ${shapeName} with your body!`, 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS(`Make a ${shapeName} with your body!`, 0.8, 'en-US' );
    }

    shapeTimeoutRef.current = setTimeout(() => {
      setCanCopy(true);
      speakTTS('Make the shape!', 0.8, 'en-US' );

      copyTimeoutRef.current = setTimeout(() => {
        setCanCopy(false);
        if (!hasCopied) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Make the shape!', 0.8, 'en-US' );
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowShape(false);
              shapeOpacity.setValue(0);
              shapeScale.setValue(1);
            } else {
              endGame();
            }
          }, 1000);
        }
      }, RESPONSE_TIME) as unknown as NodeJS.Timeout;
    }, SHAPE_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, shapeScale, shapeOpacity, round, hasCopied]);

  const handleCopy = useCallback(() => {
    if (!canCopy || done || !showShape || hasCopied) return;

    setHasCopied(true);
    setScore((s) => s + 1);
    
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect shape!', 0.9, 'en-US' );
    
    Animated.sequence([
      Animated.timing(shapeScale, {
        toValue: 1.3,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(shapeScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowShape(false);
        shapeOpacity.setValue(0);
        shapeScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [canCopy, done, showShape, hasCopied, shapeScale, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showShapeOnScreen();
    }, 500);
  }, [done, showShapeOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowShape(false);

    if (shapeTimeoutRef.current) {
      clearTimeout(shapeTimeoutRef.current);
    }
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'shape-pose',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['body-control', 'spatial-awareness', 'posture'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (shapeTimeoutRef.current) {
        clearTimeout(shapeTimeoutRef.current);
      }
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Shape Pose"
        emoji="⭕"
        description="Make circle or line with your body!"
        skills={['Body control']}
        suitableFor="Children learning body control through shape making"
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
            setShowShape(false);
            setHasCopied(false);
            shapeOpacity.setValue(0);
            shapeScale.setValue(1);
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
        <Text style={styles.title}>Shape Pose</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⭕ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canCopy ? 'Make the shape!' : 'Watch the shape...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showShape && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCopy}
            style={styles.tapArea}
            disabled={!canCopy}
          >
            <Animated.View
              style={[
                styles.shapeContainer,
                {
                  transform: [{ scale: shapeScale }],
                  opacity: shapeOpacity,
                },
              ]}
            >
              <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS[currentShape]}</Text>
              <Text style={styles.shapeLabel}>{currentShape.toUpperCase()}</Text>
              {canCopy && (
                <Text style={styles.copyLabel}>MAKE THIS SHAPE!</Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        )}

        {!showShape && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Body control
        </Text>
        <Text style={styles.footerSubtext}>
          Make the shape with your body!
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
    color: '#8B5CF6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shapeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeEmoji: {
    fontSize: 150,
    marginBottom: 10,
  },
  shapeLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8B5CF6',
    marginBottom: 10,
  },
  copyLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
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

export default ShapePoseGame;

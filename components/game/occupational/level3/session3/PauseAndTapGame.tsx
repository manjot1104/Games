import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const BEAT_DURATION = 500;
const PAUSE_DURATION = 1500; // 1.5 second pause after beat
const TAP_WINDOW = 2000; // 2 seconds to tap after pause

const PauseAndTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [phase, setPhase] = useState<'beat' | 'pause' | 'tap'>('beat');
  const [canTap, setCanTap] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);

  const drumScale = useRef(new Animated.Value(1)).current;
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tapWindowRef = useRef<NodeJS.Timeout | null>(null);

  const playBeat = useCallback(() => {
    if (done || hasTapped) return;
    
    setPhase('beat');
    setCanTap(false);
    setHasTapped(false);
    
    // Play drum sound
    playSound('drum', 0.8, 1.0);
    
    // Animate drum
    Animated.sequence([
      Animated.timing(drumScale, {
        toValue: 1.2,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(drumScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // After beat, show pause
    pauseTimerRef.current = setTimeout(() => {
      setPhase('pause');
      
      // After pause, allow tapping
      setTimeout(() => {
        setPhase('tap');
        setCanTap(true);
        
        // Close tap window
        tapWindowRef.current = setTimeout(() => {
          setCanTap(false);
          if (!hasTapped) {
            // Missed tap
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }
          // Move to next round
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setHasTapped(false);
            } else {
              endGame();
            }
          }, 500);
        }, TAP_WINDOW) as unknown as NodeJS.Timeout;
      }, PAUSE_DURATION);
    }, BEAT_DURATION) as unknown as NodeJS.Timeout;
  }, [round, done, hasTapped, drumScale]);

  const handleTap = useCallback(() => {
    if (!canTap || hasTapped || done || phase !== 'tap') return;

    setHasTapped(true);
    setCanTap(false);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    // Clear timers
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }

    // Move to next round
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setHasTapped(false);
      } else {
        endGame();
      }
    }, 500);
  }, [canTap, hasTapped, done, phase, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      playBeat();
    }, 500);
  }, [done, playBeat]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setCanTap(false);

    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'pause-and-tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['impulse-control', 'listening-skills'],
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
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
      }
      if (tapWindowRef.current) {
        clearTimeout(tapWindowRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pause & Tap"
        emoji="⏸️🥁"
        description="After the beat plays, there is a short pause, then tap"
        skills={['Impulse control', 'Listening skills']}
        suitableFor="Children who want to improve impulse control and listening skills"
        onStart={() => {
          setShowInfo(false);
          if (Platform.OS === 'web') {
            setTimeout(() => {
              speakTTS('Listen to the beat, wait for the pause, then tap!', { rate: 0.8 });
            }, 300);
          } else {
            speakTTS('Listen to the beat, wait for the pause, then tap!', { rate: 0.8 });
          }
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Result screen
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
            setHasTapped(false);
            setCanTap(false);
            setPhase('beat');
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            stopTTS();
          } catch (e) {
            // Ignore errors
          }
          stopAllSpeech();
          cleanupSounds();
          if (onBack) onBack();
        }}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>⏸️🥁 Pause & Tap</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {phase === 'beat'
              ? '🥁 Listen to the beat...'
              : phase === 'pause'
              ? '⏸️ Wait... Pause...'
              : canTap
              ? '👆 TAP NOW!'
              : '✅ Done!'}
          </Text>

          <TouchableOpacity
            style={styles.drumContainer}
            onPress={handleTap}
            activeOpacity={0.8}
            disabled={!canTap}
          >
            <Animated.View
              style={[
                styles.drum,
                phase === 'beat' && styles.drumActive,
                phase === 'tap' && canTap && styles.drumTap,
                { transform: [{ scale: drumScale }] },
              ]}
            >
              <Text style={styles.drumEmoji}>
                {phase === 'beat' ? '🥁' : phase === 'pause' ? '⏸️' : '👆'}
              </Text>
              {canTap && (
                <View style={styles.drumGlow}>
                  <Text style={styles.drumGlowText}>✨</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          {phase === 'pause' && (
            <Text style={styles.pauseHint}>Wait... Don't tap yet! ⏸️</Text>
          )}
          {canTap && (
            <Text style={styles.tapHint}>Now tap! 👆</Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  header: {
    paddingTop: 100,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 16,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gameArea: {
    width: '100%',
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#78350F',
    marginBottom: 40,
    textAlign: 'center',
  },
  drumContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  drum: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    borderWidth: 4,
    borderColor: '#EA580C',
  },
  drumActive: {
    backgroundColor: '#DC2626',
    borderColor: '#B91C1C',
    shadowColor: '#DC2626',
  },
  drumTap: {
    backgroundColor: '#22C55E',
    borderColor: '#16A34A',
    shadowColor: '#22C55E',
  },
  drumEmoji: {
    fontSize: 80,
  },
  drumGlow: {
    position: 'absolute',
    top: -20,
    right: -20,
  },
  drumGlowText: {
    fontSize: 40,
  },
  pauseHint: {
    marginTop: 30,
    fontSize: 20,
    fontWeight: '700',
    color: '#F59E0B',
    textAlign: 'center',
  },
  tapHint: {
    marginTop: 30,
    fontSize: 20,
    fontWeight: '700',
    color: '#22C55E',
    textAlign: 'center',
  },
});

export default PauseAndTapGame;


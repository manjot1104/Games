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

const TOTAL_ROUNDS = 12;
const FAST_BEAT_INTERVAL = 400; // Fast beats - 400ms between beats
const SOUND_DURATION = 300;
const BEATS_PER_ROUND = 5; // 5 fast beats per round
const TAP_WINDOW = 500; // 500ms window to tap after each beat

const FastBeatChallengeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDrumPlaying, setIsDrumPlaying] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [canTap, setCanTap] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [hasTappedThisBeat, setHasTappedThisBeat] = useState(false);

  const drumScale = useRef(new Animated.Value(1)).current;
  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tapWindowRef = useRef<NodeJS.Timeout | null>(null);

  const playBeat = useCallback(() => {
    if (done || beatCount >= BEATS_PER_ROUND) return;
    
    setIsDrumPlaying(true);
    setCanTap(true);
    setHasTappedThisBeat(false);
    
    // Play drum sound
    playSound('drum', 0.8, 1.0);
    
    // Animate drum
    Animated.sequence([
      Animated.timing(drumScale, {
        toValue: 1.15,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(drumScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Stop sound after duration
    setTimeout(() => {
      setIsDrumPlaying(false);
    }, SOUND_DURATION);

    // Close tap window quickly for fast beats
    tapWindowRef.current = setTimeout(() => {
      setCanTap(false);
      if (!hasTappedThisBeat) {
        // Missed tap
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
      
      // Move to next beat or round
      setBeatCount((prev) => {
        const next = prev + 1;
        if (next >= BEATS_PER_ROUND) {
          // Round complete
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setBeatCount(0);
              setHasTappedThisBeat(false);
            } else {
              endGame();
            }
          }, 300);
        }
        return next;
      });
    }, TAP_WINDOW) as unknown as NodeJS.Timeout;
  }, [round, done, beatCount, hasTappedThisBeat, drumScale]);

  const startBeatSequence = useCallback(() => {
    if (isPlaying || done) return;
    
    setIsPlaying(true);
    setBeatCount(0);
    setHasTappedThisBeat(false);
    
    // Play first beat immediately
    playBeat();
    
    // Then play at fast intervals
    beatIntervalRef.current = setInterval(() => {
      if (beatCount < BEATS_PER_ROUND) {
        playBeat();
      } else {
        if (beatIntervalRef.current) {
          clearInterval(beatIntervalRef.current);
          beatIntervalRef.current = null;
        }
        setIsPlaying(false);
      }
    }, FAST_BEAT_INTERVAL) as unknown as NodeJS.Timeout;
  }, [isPlaying, done, beatCount, playBeat]);

  const handleTap = useCallback(() => {
    if (!canTap || hasTappedThisBeat || done) return;

    setHasTappedThisBeat(true);
    setCanTap(false);
    setScore((s) => s + 1);
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    // Clear tap window
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }
  }, [canTap, hasTappedThisBeat, done]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      startBeatSequence();
    }, 500);
  }, [done, startBeatSequence]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * BEATS_PER_ROUND;
    const xp = score * 8;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    setIsDrumPlaying(false);

    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'fast-beat-challenge',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reaction-speed', 'motor-planning'],
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
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
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
        title="Fast Beat Challenge"
        emoji="⚡🥁"
        description="Beats are faster than normal"
        skills={['Reaction speed', 'Motor planning']}
        suitableFor="Children who want to improve reaction speed and motor planning"
        onStart={() => {
          setShowInfo(false);
          if (Platform.OS === 'web') {
            setTimeout(() => {
              speakTTS('Fast beats coming! Tap quickly!', 0.8 );
            }, 300);
          } else {
            speakTTS('Fast beats coming! Tap quickly!', 0.8 );
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
            setBeatCount(0);
            setHasTappedThisBeat(false);
            setIsPlaying(false);
            setIsDrumPlaying(false);
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
        <Text style={styles.title}>⚡🥁 Fast Beat Challenge</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
        {isPlaying && (
          <Text style={styles.beatIndicator}>Beat: {beatCount}/{BEATS_PER_ROUND}</Text>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {isPlaying
              ? isDrumPlaying && canTap
                ? '⚡ TAP FAST!'
                : '👂 Listen...'
              : '⏳ Starting...'}
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
                isDrumPlaying && canTap && styles.drumActive,
                { transform: [{ scale: drumScale }] },
              ]}
            >
              <Text style={styles.drumEmoji}>🥁</Text>
              {canTap && (
                <View style={styles.drumGlow}>
                  <Text style={styles.drumGlowText}>⚡</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          {canTap && (
            <Text style={styles.tapHint}>Quick! Tap now! ⚡</Text>
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
    marginBottom: 8,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  beatIndicator: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DC2626',
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
  tapHint: {
    marginTop: 30,
    fontSize: 20,
    fontWeight: '700',
    color: '#DC2626',
    textAlign: 'center',
  },
});

export default FastBeatChallengeGame;


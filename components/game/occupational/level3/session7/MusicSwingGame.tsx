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
    PanResponder,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BEAT_INTERVAL = 800; // ms between beats
const SWING_TOLERANCE = 300; // ms tolerance for swing timing
const SWIPE_THRESHOLD = 100; // Minimum swipe distance

const MusicSwingGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showSwing, setShowSwing] = useState(false);
  const [hasSwung, setHasSwung] = useState(false);
  const [phase, setPhase] = useState<'listen' | 'swing'>('listen');
  const [beatCount, setBeatCount] = useState(0);
  const [userSwings, setUserSwings] = useState<number[]>([]);

  const swingX = useRef(new Animated.Value(50)).current; // 50% center
  const swingScale = useRef(new Animated.Value(1)).current;
  const beatScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastBeatTime = useRef(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  const playBeats = useCallback(() => {
    if (done) return;
    
    setPhase('listen');
    setBeatCount(0);
    setUserSwings([]);

    // Play first beat
    lastBeatTime.current = Date.now();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.sequence([
      Animated.timing(beatScale, {
        toValue: 1.5,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(beatScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    setBeatCount(1);

    // Play 3 more beats
    const playNextBeat = (count: number) => {
      if (count > 4 || done) return;
      
      beatTimeoutRef.current = setTimeout(() => {
        lastBeatTime.current = Date.now();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        Animated.sequence([
          Animated.timing(beatScale, {
            toValue: 1.5,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(beatScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();

        setBeatCount(count);

        if (count < 4) {
          playNextBeat(count + 1);
        } else {
          // After all beats, allow swinging
          setTimeout(() => {
            setPhase('swing');
            speakTTS('Ab music ke sath swing karo! Beat ko follow karo!', 0.8 );
          }, 300);
        }
      }, BEAT_INTERVAL) as unknown as NodeJS.Timeout;
    };

    playNextBeat(2);
  }, [done, beatScale]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => phase === 'swing' && !hasSwung,
      onMoveShouldSetPanResponder: () => phase === 'swing' && !hasSwung,
      onPanResponderGrant: (evt) => {
        if (phase !== 'swing' || hasSwung) return;
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        if (phase !== 'swing' || hasSwung) return;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Move swing object
        const newXPct = ((swipeStartX.current + deltaX) / SCREEN_WIDTH) * 100;
        swingX.setValue(Math.max(20, Math.min(80, newXPct)));
      },
      onPanResponderRelease: (evt) => {
        if (phase !== 'swing' || hasSwung) return;
        
        const distance = swipeDistance.current;
        const now = Date.now();
        
        if (distance >= SWIPE_THRESHOLD) {
          // Check timing with beat
          const timeSinceBeat = (now - lastBeatTime.current) % BEAT_INTERVAL;
          const timingDiff = Math.min(timeSinceBeat, BEAT_INTERVAL - timeSinceBeat);
          
          if (timingDiff <= SWING_TOLERANCE) {
            // On beat!
            const newSwings = [...userSwings, now];
            setUserSwings(newSwings);
            
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            speakTTS('Perfect beat!', 0.9 );
            
            // Success animation
            Animated.sequence([
              Animated.timing(swingScale, {
                toValue: 1.3,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(swingScale, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
              }),
            ]).start();
            
            // Check if enough swings completed
            if (newSwings.length >= 4) {
              // Completed all swings
              handleSuccess();
            } else {
              // Wait for next beat
              setTimeout(() => {
                lastBeatTime.current = Date.now();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }, BEAT_INTERVAL - timingDiff);
            }
          } else {
            // Off beat
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            speakTTS('Beat ke sath swing karo! Music follow karo!', 0.8 );
            
            // Reset position
            Animated.spring(swingX, {
              toValue: 50,
              damping: 10,
              stiffness: 100,
              useNativeDriver: false,
            }).start();
          }
        } else {
          // Not enough swipe
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Zada swing karo!', 0.8 );
        }
      },
    })
  ).current;

  const handleSuccess = useCallback(() => {
    setHasSwung(true);
    setScore((s) => s + 1);
    
    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect music swing!', 0.9 );
    
    // Success animation
    Animated.parallel([
      Animated.sequence([
        Animated.timing(swingScale, {
          toValue: 1.5,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(swingScale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowSwing(false);
        setHasSwung(false);
        setPhase('listen');
        setBeatCount(0);
        setUserSwings([]);
        swingX.setValue(50);
        swingScale.setValue(1);
        beatScale.setValue(1);
        lastBeatTime.current = 0;
      } else {
        endGame();
      }
    }, 1000);
  }, [round, swingX, swingScale, beatScale]);

  const showSwingObject = useCallback(() => {
    setShowSwing(true);
    setHasSwung(false);
    setPhase('listen');
    setBeatCount(0);
    setUserSwings([]);
    swingX.setValue(50);
    swingScale.setValue(1);
    beatScale.setValue(1);
    lastBeatTime.current = 0;
    
    // Start playing beats
    setTimeout(() => {
      playBeats();
    }, 500);
  }, [swingScale, swingX, beatScale, playBeats]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showSwingObject();
    }, 500);
  }, [done, showSwingObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowSwing(false);

    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'music-swing',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm', 'body-sync', 'music-coordination'],
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
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Music Swing"
        emoji="🎵"
        description="Music ke sath swing! Beat ko follow karo aur same rhythm mein swing karo!"
        skills={['Rhythm', 'Body sync', 'Music coordination']}
        suitableFor="Children learning rhythm and body synchronization with music"
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
            setShowSwing(false);
            setHasSwung(false);
            setPhase('listen');
            setBeatCount(0);
            setUserSwings([]);
            swingX.setValue(50);
            swingScale.setValue(1);
            beatScale.setValue(1);
            lastBeatTime.current = 0;
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
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
        <Text style={styles.title}>Music Swing</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen' ? 'Music suno... Beat follow karo!' : 'Ab beat ke sath swing karo!'}
        </Text>
        {phase === 'listen' && beatCount > 0 && (
          <Text style={styles.beatIndicator}>
            Beat: {beatCount}/4
          </Text>
        )}
        {phase === 'swing' && (
          <Text style={styles.swingIndicator}>
            Swings: {userSwings.length}/4
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showSwing && (
          <>
            {/* Beat indicator */}
            {phase === 'listen' && (
              <Animated.View
                style={[
                  styles.beatContainer,
                  {
                    transform: [{ scale: beatScale }],
                  },
                ]}
              >
                <Text style={styles.beatText}>♪ Beat {beatCount} ♪</Text>
              </Animated.View>
            )}

            {/* Swing object */}
            {phase === 'swing' && (
              <Animated.View
                style={[
                  styles.swingContainer,
                  {
                    left: swingX.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                    top: '50%',
                    transform: [
                      { translateX: -50 },
                      { translateY: -50 },
                      { scale: swingScale },
                    ],
                  },
                ]}
              >
                <Text style={styles.swingEmoji}>🎵</Text>
                <Text style={styles.swingLabel}>SWING WITH BEAT</Text>
              </Animated.View>
            )}
          </>
        )}

        {!showSwing && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Rhythm • Body sync • Music coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Listen to the music and swing in rhythm with the beats!
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
    marginBottom: 8,
  },
  beatIndicator: {
    fontSize: 20,
    color: '#8B5CF6',
    fontWeight: '800',
  },
  swingIndicator: {
    fontSize: 20,
    color: '#22C55E',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  beatContainer: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beatText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#8B5CF6',
  },
  swingContainer: {
    position: 'absolute',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swingEmoji: {
    fontSize: 70,
    marginBottom: 8,
  },
  swingLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
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

export default MusicSwingGame;



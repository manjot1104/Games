import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 12;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SOUND_SIZE = 120;

type Side = 'left' | 'right';
type SoundType = 'bell' | 'drum' | 'clap' | 'beep';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const SoundSideTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [soundSide, setSoundSide] = useState<Side | null>(null);
  const [soundType, setSoundType] = useState<SoundType>('bell');
  const [hasTapped, setHasTapped] = useState(false);

  const leftSoundScale = useRef(new Animated.Value(1)).current;
  const rightSoundScale = useRef(new Animated.Value(1)).current;
  const leftSoundOpacity = useRef(new Animated.Value(0.3)).current;
  const rightSoundOpacity = useRef(new Animated.Value(0.3)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const playSoundOnSide = useCallback(() => {
    // Randomly choose side and sound type
    const side: Side = Math.random() < 0.5 ? 'left' : 'right';
    const sounds: SoundType[] = ['bell', 'drum', 'clap', 'beep'];
    const sound = sounds[Math.floor(Math.random() * sounds.length)];
    
    setSoundSide(side);
    setSoundType(sound);
    setHasTapped(false);
    
    // Reset scales
    leftSoundScale.setValue(1);
    rightSoundScale.setValue(1);
    
    // Animate active side
    if (side === 'left') {
      leftSoundOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(leftSoundOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(leftSoundOpacity, {
              toValue: 0.6,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(leftSoundOpacity, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      rightSoundOpacity.setValue(0.3);
    } else {
      rightSoundOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(rightSoundOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(rightSoundOpacity, {
              toValue: 0.6,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(rightSoundOpacity, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      leftSoundOpacity.setValue(0.3);
    }
    
    // Play sound on the side
    playSound(sound as any, 0.8, 1.0);
    speak(`Sound on ${side} side!`);
    
    // Auto-advance after 3 seconds if not tapped
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (!hasTapped && soundSide === side) {
        handleTimeout();
      }
    }, 3000);
  }, [leftSoundOpacity, rightSoundOpacity, hasTapped, soundSide]);

  const handleLeftTap = useCallback(() => {
    if (done || !soundSide || hasTapped) return;
    
    if (soundSide === 'left') {
      handleSuccess('left');
    } else {
      handleWrong();
    }
  }, [done, soundSide, hasTapped]);

  const handleRightTap = useCallback(() => {
    if (done || !soundSide || hasTapped) return;
    
    if (soundSide === 'right') {
      handleSuccess('right');
    } else {
      handleWrong();
    }
  }, [done, soundSide, hasTapped]);

  const handleSuccess = useCallback((side: Side) => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    const soundScale = side === 'left' ? leftSoundScale : rightSoundScale;
    
    Animated.sequence([
      Animated.timing(soundScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(soundScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Perfect!');
    
    // Fade out active side
    const soundOpacity = side === 'left' ? leftSoundOpacity : rightSoundOpacity;
    Animated.timing(soundOpacity, {
      toValue: 0.3,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setSoundSide(null);
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          playSoundOnSide();
        } else {
          endGame();
        }
      }, 500);
    });
  }, [round, leftSoundScale, rightSoundScale, leftSoundOpacity, rightSoundOpacity, playSoundOnSide]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(`Tap ${soundSide} side!`);
    
    // Shake animation
    const wrongScale = soundSide === 'left' ? rightSoundScale : leftSoundScale;
    Animated.sequence([
      Animated.timing(wrongScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(wrongScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [soundSide, leftSoundScale, rightSoundScale]);

  const handleTimeout = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak('Too slow!');
    
    setSoundSide(null);
    leftSoundOpacity.setValue(0.3);
    rightSoundOpacity.setValue(0.3);
    
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        playSoundOnSide();
      } else {
        endGame();
      }
    }, 500);
  }, [hasTapped, round, leftSoundOpacity, rightSoundOpacity, playSoundOnSide]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setSoundSide(null);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'sound-side-tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['auditory-processing', 'alternating-sides', 'sound-localization'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        playSoundOnSide();
      }, 500);
    }
  }, [showInfo, round, done, playSoundOnSide]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const getSoundEmoji = (sound: SoundType) => {
    switch (sound) {
      case 'bell': return '🔔';
      case 'drum': return '🥁';
      case 'clap': return '👏';
      case 'beep': return '🔊';
    }
  };

  const leftSoundStyle = {
    opacity: leftSoundOpacity,
    transform: [{ scale: leftSoundScale }],
  };

  const rightSoundStyle = {
    opacity: rightSoundOpacity,
    transform: [{ scale: rightSoundScale }],
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Sound Side Tap"
        emoji="🔊"
        description="Sound jis side aaye tap! Auditory processing!"
        skills={['Auditory processing', 'Sound localization', 'Alternating sides']}
        suitableFor="Children learning to process sounds and identify sound location"
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
            setSoundSide(null);
            leftSoundOpacity.setValue(0.3);
            rightSoundOpacity.setValue(0.3);
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
        <Text style={styles.title}>Sound Side Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {soundSide ? `Sound on ${soundSide} side!` : 'Listen for sound...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.soundsContainer}>
          <TouchableOpacity
            style={styles.soundButton}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.sound, styles.leftSound, leftSoundStyle]}>
              <Text style={styles.soundEmoji}>
                {soundSide === 'left' ? getSoundEmoji(soundType) : '🔊'}
              </Text>
              <Text style={styles.soundLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.soundButton}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.sound, styles.rightSound, rightSoundStyle]}>
              <Text style={styles.soundEmoji}>
                {soundSide === 'right' ? getSoundEmoji(soundType) : '🔊'}
              </Text>
              <Text style={styles.soundLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Auditory processing • Sound localization • Alternating sides
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
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  soundsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  soundButton: {
    width: SOUND_SIZE,
    height: SOUND_SIZE,
  },
  sound: {
    width: SOUND_SIZE,
    height: SOUND_SIZE,
    borderRadius: SOUND_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftSound: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightSound: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  soundEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  soundLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default SoundSideTapGame;

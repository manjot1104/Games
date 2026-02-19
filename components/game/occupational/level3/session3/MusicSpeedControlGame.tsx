import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    PanResponder,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FAST_SWIPE_THRESHOLD = 300; // Maximum time for fast swipe (ms)
const SLOW_SWIPE_THRESHOLD = 1000; // Minimum time for slow swipe (ms)
const MIN_SWIPE_DISTANCE = 50;

type MusicSpeed = 'slow' | 'fast';

const MusicSpeedControlGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentMusicSpeed, setCurrentMusicSpeed] = useState<MusicSpeed>('slow');
  const [showMusic, setShowMusic] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  const musicScale = useRef(new Animated.Value(0)).current;
  const musicOpacity = useRef(new Animated.Value(0)).current;
  const swipeStartTime = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartTime.current = Date.now();
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt, gestureState) => {
        swipeDistance.current = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
      },
      onPanResponderRelease: (evt) => {
        const swipeTime = Date.now() - swipeStartTime.current;
        const distance = swipeDistance.current;
        
        if (showMusic && !hasSwiped && distance >= MIN_SWIPE_DISTANCE) {
          const isFast = swipeTime <= FAST_SWIPE_THRESHOLD;
          const isSlow = swipeTime >= SLOW_SWIPE_THRESHOLD;
          
          if ((currentMusicSpeed === 'fast' && isFast) || (currentMusicSpeed === 'slow' && isSlow)) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const playMusic = useCallback(async (speed: MusicSpeed) => {
    try {
      // Create a simple tone pattern
      // For slow: longer intervals, for fast: shorter intervals
      if (Platform.OS !== 'web') {
        // On native, we can use Audio API
        // For now, just use visual/audio cues
      }
    } catch (error) {
      console.warn('Music playback error:', error);
    }
  }, []);

  const showMusicSpeed = useCallback(() => {
    const speed: MusicSpeed = Math.random() > 0.5 ? 'slow' : 'fast';
    setCurrentMusicSpeed(speed);
    setShowMusic(true);
    setHasSwiped(false);
    
    Animated.parallel([
      Animated.spring(musicScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(musicOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    playMusic(speed);

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(speed === 'fast' ? 'Fast music! Move fast!' : 'Slow music! Move slow!', 0.8 );
      }, 300);
    } else {
      speakTTS(speed === 'fast' ? 'Fast music! Move fast!' : 'Slow music! Move slow!', 0.8 );
    }
  }, [musicScale, musicOpacity, playMusic]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(musicScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(musicOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (sound) {
      sound.stopAsync().catch(() => {});
    }

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowMusic(false);
        musicScale.setValue(0);
        musicOpacity.setValue(0);
      } else {
        endGame();
      }
    }, 500);
  }, [round, musicScale, musicOpacity, sound]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => {
      setHasSwiped(false);
      swipeDistance.current = 0;
    }, 500);
  }, []);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showMusicSpeed();
    }, 500);
  }, [done, showMusicSpeed]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowMusic(false);

    if (sound) {
      sound.stopAsync().catch(() => {});
    }

    try {
      await logGameAndAward({
        type: 'music-speed-control',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['auditory-motor-integration'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router, sound]);

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
      if (sound) {
        sound.unloadAsync().catch(() => {});
      }
      cleanupSounds();
    };
  }, [sound]);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Music Speed Control"
        emoji="🎵"
        description="Music slow → slow movement, Music fast → fast movement"
        skills={['Auditory-motor integration']}
        suitableFor="Children who want to develop auditory-motor integration"
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
            setShowMusic(false);
            setHasSwiped(false);
            musicScale.setValue(0);
            musicOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const colors = currentMusicSpeed === 'fast' 
    ? ['#F59E0B', '#D97706'] 
    : ['#3B82F6', '#2563EB'];
  const musicText = currentMusicSpeed === 'fast' ? 'FAST MUSIC' : 'SLOW MUSIC';
  const instructionText = currentMusicSpeed === 'fast' ? 'Move fast!' : 'Move slow!';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#ECFDF5', '#D1FAE5', '#A7F3D0']}
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
        <Text style={styles.title}>🎵 Music Speed Control</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showMusic && (
          <Animated.View
            style={[
              styles.musicBox,
              {
                transform: [{ scale: musicScale }],
                opacity: musicOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={colors}
              style={styles.musicGradient}
            >
              <Text style={styles.musicEmoji}>🎵</Text>
              <Text style={styles.musicText}>{musicText}</Text>
              <Text style={styles.instructionText}>{instructionText}</Text>
            </LinearGradient>
          </Animated.View>
        )}
        
        {!showMusic && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready... 👀</Text>
          </View>
        )}
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
    color: '#065F46',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#047857',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  musicBox: {
    width: SCREEN_WIDTH * 0.7,
    height: 250,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  musicGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  musicEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  musicText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
    marginBottom: 10,
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#E0E7FF',
  },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#047857',
  },
});

export default MusicSpeedControlGame;


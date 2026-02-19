import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const FACE_CENTER_X = 50;
const FACE_CENTER_Y = 50;
const FACE_RADIUS = 25;

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

type FeatureType = 'eye' | 'mouth';

const FaceSymmetryDrawGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [targetFeature, setTargetFeature] = useState<FeatureType>('eye');
  const [leftEye, setLeftEye] = useState<{ x: number; y: number } | null>(null);
  const [rightEye, setRightEye] = useState<{ x: number; y: number } | null>(null);
  const [mouth, setMouth] = useState<{ x: number; y: number; width: number } | null>(null);
  const sparkleX = useSharedValue(50);
  const sparkleY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'faceSymmetryDraw',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['bilateral-coordination', 'spatial-awareness', 'mirror-drawing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log face symmetry draw game:', e);
      }

      speakTTS('Face complete!', 0.78 );
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onEnd((e) => {
      if (!roundActive || done) return;
      
      const x = (e.x / screenWidth.current) * 100;
      const y = (e.y / screenHeight.current) * 100;
      
      if (targetFeature === 'eye' && !leftEye && x < FACE_CENTER_X) {
        setLeftEye({ x, y });
        const mirrorX = FACE_CENTER_X + (FACE_CENTER_X - x);
        setRightEye({ x: mirrorX, y });
        
        setTimeout(() => {
          setTargetFeature('mouth');
        }, 500);
      } else if (targetFeature === 'mouth' && !mouth && Math.abs(y - FACE_CENTER_Y) < 15) {
        const width = Math.abs(x - FACE_CENTER_X) * 2;
        setMouth({ x: FACE_CENTER_X, y, width });
        
        sparkleX.value = FACE_CENTER_X;
        sparkleY.value = FACE_CENTER_Y;
        
        setScore(s => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound(r => r + 1);
              setLeftEye(null);
              setRightEye(null);
              setMouth(null);
              setTargetFeature('eye');
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        try {
          playWarning();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS(`Tap to place ${targetFeature}!`, 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    setLeftEye(null);
    setRightEye(null);
    setMouth(null);
    setTargetFeature('eye');
    setRoundActive(true);
    try {
      speakTTS('Tap to place left eye, right will mirror', { rate: 0.78 });
    } catch {}
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  useEffect(() => {
    if (targetFeature === 'mouth') {
      try {
        speakTTS('Tap to place mouth, centered', { rate: 0.78 });
      } catch {}
    }
    
    return () => {
      stopAllSpeech();
    };
  }, [targetFeature]);

  useEffect(() => {
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>😊</Text>
            <Text style={styles.resultTitle}>Faces Complete!</Text>
            <Text style={styles.resultSubtitle}>
              You drew {finalStats.correct} faces out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setLeftEye(null);
                setRightEye(null);
                setMouth(null);
                setTargetFeature('eye');
                setRoundActive(true);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Face Symmetry Draw</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 😊 Score: {score}
        </Text>
        <Text style={styles.helper}>
          {targetFeature === 'eye' ? 'Tap to place left eye (right will mirror)' : 'Tap to place mouth (centered)'}
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.gestureArea}>
            <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.svg}>
              {/* Face circle */}
              <Circle
                cx={FACE_CENTER_X}
                cy={FACE_CENTER_Y}
                r={FACE_RADIUS}
                fill="none"
                stroke="#FCD34D"
                strokeWidth="2"
                strokeDasharray="2 2"
              />
              
              {/* Left eye */}
              {leftEye && (
                <Circle
                  cx={leftEye.x}
                  cy={leftEye.y}
                  r="3"
                  fill="#0F172A"
                />
              )}
              
              {/* Right eye (mirrored) */}
              {rightEye && (
                <Circle
                  cx={rightEye.x}
                  cy={rightEye.y}
                  r="3"
                  fill="#0F172A"
                />
              )}
              
              {/* Mouth */}
              {mouth && (
                <Line
                  x1={mouth.x - mouth.width / 2}
                  y1={mouth.y}
                  x2={mouth.x + mouth.width / 2}
                  y2={mouth.y}
                  stroke="#0F172A"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </Svg>

            {score > 0 && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}
          </View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: bilateral coordination • spatial awareness • mirror drawing
        </Text>
        <Text style={styles.footerSub}>
          Draw features that mirror symmetrically!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  svg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default FaceSymmetryDrawGame;


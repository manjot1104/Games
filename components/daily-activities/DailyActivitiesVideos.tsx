import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// Video data structure
interface VideoItem {
  id: string;
  title: string;
  description: string;
  videoPath: any; // Can be require() for native or URL for web
  thumbnail?: string;
}

// Video list - social story videos for learning life skills
const DAILY_ACTIVITIES_VIDEOS: VideoItem[] = [
  {
    id: 'basics-of-life-1',
    title: 'Child Learns Not to Eat Grass',
    description: 'A child starts eating grass and her mother stops her. When she stops eating grass, she gets a reward of an apple.',
    videoPath: require('@/assets/videos/Child_Learns_Not_to_Eat_Grass.mp4'),
  },
  {
    id: 'wait-for-turn-1',
    title: 'Learning to Wait for Your Turn',
    description: 'A child learns the importance of patience and waiting. The child waits for their turn and then gets rewarded with a toy or gets their turn to play. This teaches patience, turn-taking, self-control, and that good things come to those who wait.',
    videoPath: require('@/assets/videos/wait to get reward.mp4'),
  },
  {
    id: 'being-kind-1',
    title: 'Being Kind to Others',
    description: 'A gentle animated story where a child notices a sad classmate and chooses to be kind by sharing a toy. As they play together, more children join and everyone becomes happy. This teaches empathy, kindness, sharing, friendship, and how small acts of kindness can make everyone feel better.',
    videoPath: require('@/assets/videos/being kind to others.mp4'),
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Smaller cards in grid layout - 2 columns with gap
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_GAP) / 2; // 2 columns with gap
const CARD_HEIGHT = (CARD_WIDTH * 9) / 16; // 16:9 aspect ratio

export function DailyActivitiesVideos() {
  const router = useRouter();
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);

  const handleVideoPress = (video: VideoItem) => {
    setSelectedVideo(video);
  };

  const handleBack = () => {
    setSelectedVideo(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Social Stories</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introSection}>
          <Text style={styles.introTitle}>Learn Life Skills</Text>
          <Text style={styles.introDescription}>
            Watch educational social story videos to learn important life skills. These animated stories teach children about safety, patience, turn-taking, self-control, kindness, empathy, sharing, and following rules through gentle, engaging narratives.
          </Text>
        </View>

        <View style={styles.videosGrid}>
          {DAILY_ACTIVITIES_VIDEOS.map((video) => (
            <VideoCard key={video.id} video={video} onPress={handleVideoPress} />
          ))}
        </View>
      </ScrollView>

      {/* Video Player Modal - Small Screen */}
      <Modal
        visible={selectedVideo !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={handleBack}
      >
        {selectedVideo && (
          <VideoPlayer video={selectedVideo} onBack={handleBack} />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function VideoCard({
  video,
  onPress,
}: {
  video: VideoItem;
  onPress: (video: VideoItem) => void;
}) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(true);

  useEffect(() => {
    // Generate thumbnail from video
    generateThumbnail(video.videoPath)
      .then((uri) => {
        setThumbnailUri(uri);
        setThumbnailLoading(false);
      })
      .catch((err) => {
        console.warn('Failed to generate thumbnail:', err);
        setThumbnailLoading(false);
      });
  }, [video.videoPath]);

  return (
    <TouchableOpacity
      style={styles.videoCard}
      onPress={() => onPress(video)}
      activeOpacity={0.9}
    >
      <View style={styles.videoThumbnail}>
        <View style={styles.playButtonOverlay}>
          <View style={styles.playButton}>
            <Ionicons name="play" size={20} color="#FFF" />
          </View>
        </View>
        {thumbnailLoading ? (
          <View style={styles.videoPlaceholder}>
            <ActivityIndicator size="small" color="#EC4899" />
          </View>
        ) : thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={styles.thumbnailImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam" size={48} color="#EC4899" />
          </View>
        )}
      </View>

      <View style={styles.videoInfo}>
        <Text style={styles.videoTitle} numberOfLines={2}>
          {video.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// Generate thumbnail from video (first frame)
async function generateThumbnail(videoPath: any): Promise<string> {
  if (Platform.OS === 'web') {
    return generateWebThumbnail(videoPath);
  } else {
    return generateNativeThumbnail(videoPath);
  }
}

// Generate thumbnail for web using HTML5 video
async function generateWebThumbnail(videoPath: any): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Get video source URL
      let videoSrc: string = '';
      
      if (typeof videoPath === 'string') {
        videoSrc = videoPath;
      } else if (videoPath?.uri) {
        videoSrc = videoPath.uri;
      } else if (typeof videoPath === 'object') {
        if ('default' in videoPath && typeof videoPath.default === 'string') {
          videoSrc = videoPath.default;
        } else if ('uri' in videoPath && typeof videoPath.uri === 'string') {
          videoSrc = videoPath.uri;
        } else if (typeof (videoPath as any).__packager_asset === 'object') {
          const asset = (videoPath as any).__packager_asset;
          videoSrc = asset.uri || asset.httpServerLocation + '/' + asset.name;
        }
      }

      if (!videoSrc) {
        reject(new Error('Could not determine video source'));
        return;
      }

      const video = document.createElement('video');
      video.src = videoSrc;
      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';

      video.addEventListener('loadedmetadata', () => {
        video.currentTime = 0.1; // Seek to 0.1 seconds to get a frame
      });

      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(thumbnailDataUrl);
          } else {
            reject(new Error('Could not get canvas context'));
          }
        } catch (err) {
          reject(err);
        }
      });

      video.addEventListener('error', (e) => {
        reject(new Error('Video load error'));
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Thumbnail generation timeout'));
      }, 5000);
    } catch (err) {
      reject(err);
    }
  });
}

// Generate thumbnail for native using expo-av
async function generateNativeThumbnail(videoPath: any): Promise<string> {
  try {
    // Try expo-video-thumbnails first if available
    try {
      const { getThumbnailAsync } = require('expo-video-thumbnails');
      
      // Get video source
      const videoSource = typeof videoPath === 'object' && videoPath
        ? videoPath
        : typeof videoPath === 'string'
        ? { uri: videoPath }
        : videoPath;

      const { uri } = await getThumbnailAsync(videoSource, {
        time: 100, // 0.1 seconds
        quality: 0.8,
      });
      return uri;
    } catch (e) {
      // Fallback: For native, we can't easily generate thumbnails without expo-video-thumbnails
      // Return null to show placeholder
      console.warn('expo-video-thumbnails not available, will show placeholder');
      throw new Error('Thumbnail generation not available');
    }
  } catch (err) {
    throw err;
  }
}

function VideoPlayer({
  video,
  onBack,
}: {
  video: VideoItem;
  onBack: () => void;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use expo-av Video component for native, HTML5 video for web
  // expo-av Video works better with require() assets on native
  const VideoComponent = Platform.OS === 'web' ? WebVideoPlayer : NativeVideoPlayer;

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {video.title}
          </Text>
          <TouchableOpacity onPress={onBack} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Video Player - Small Screen */}
        <View style={styles.modalVideoWrapper}>
          <VideoComponent
            video={video}
            onLoad={() => setIsLoading(false)}
            onError={(err) => {
              setError(err);
              setIsLoading(false);
            }}
            onPlayStateChange={setIsPlaying}
          />

          {isLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#EC4899" />
              <Text style={styles.loadingText}>Loading video...</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorOverlay}>
              <Ionicons name="alert-circle" size={48} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setError(null);
                  setIsLoading(true);
                }}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Video Info */}
        <View style={styles.modalInfoSection}>
          <Text style={styles.modalInfoTitle}>{video.title}</Text>
          <Text style={styles.modalInfoDescription}>{video.description}</Text>
        </View>
      </View>
    </View>
  );
}

// Web video player using HTML5 video
function WebVideoPlayer({
  video,
  onLoad,
  onError,
  onPlayStateChange,
}: {
  video: VideoItem;
  onLoad: () => void;
  onError: (error: string) => void;
  onPlayStateChange: (playing: boolean) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Get video source from require() - Metro bundler processes it
    let videoSrc: string = '';
    
    if (typeof video.videoPath === 'string') {
      videoSrc = video.videoPath;
    } else if (video.videoPath?.uri) {
      videoSrc = video.videoPath.uri;
    } else if (typeof video.videoPath === 'object') {
      // For require() on web, Metro provides different formats
      // Try common properties that Metro might use
      if ('default' in video.videoPath && typeof video.videoPath.default === 'string') {
        videoSrc = video.videoPath.default;
      } else if ('uri' in video.videoPath && typeof video.videoPath.uri === 'string') {
        videoSrc = video.videoPath.uri;
      } else if (typeof (video.videoPath as any).__packager_asset === 'object') {
        // Metro asset format
        const asset = (video.videoPath as any).__packager_asset;
        videoSrc = asset.uri || asset.httpServerLocation + '/' + asset.name;
      } else {
        // Last resort: try to stringify and parse, or use the object itself
        console.warn('Could not extract video URL from:', video.videoPath);
        // Try to use expo-av for web as fallback
        onError('Video format not supported on web. Please use a direct URL or ensure the video is properly bundled.');
        return;
      }
    }

    if (!videoSrc) {
      onError('Could not determine video source URL');
      return;
    }

    console.log('Loading video from:', videoSrc);

    const videoElement = document.createElement('video');
    videoElement.src = videoSrc;
    videoElement.controls = true;
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'contain';
    videoElement.style.backgroundColor = '#000';
    videoElement.preload = 'auto';

    const handleLoadedData = () => {
      onLoad();
      onPlayStateChange(!videoElement.paused);
    };

    const handlePlay = () => onPlayStateChange(true);
    const handlePause = () => onPlayStateChange(false);
    const handleError = (e: any) => {
      console.error('Video error:', e, videoElement.error);
      const errorMsg = videoElement.error
        ? `Video error: ${videoElement.error.code} - ${videoElement.error.message}`
        : 'Failed to load video. Please check if the video file exists.';
      onError(errorMsg);
    };

    videoElement.addEventListener('loadeddata', handleLoadedData);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('error', handleError);

    const container = document.getElementById('video-container');
    if (container) {
      container.innerHTML = '';
      container.appendChild(videoElement);
      videoRef.current = videoElement;
    }

    return () => {
      videoElement.removeEventListener('loadeddata', handleLoadedData);
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('error', handleError);
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, [video.videoPath, onLoad, onError, onPlayStateChange]);

  return (
    <View style={styles.videoContainer}>
      <View
        id="video-container"
        ref={(ref) => {
          if (Platform.OS === 'web' && ref) {
            containerRef.current = ref as any;
          }
        }}
        style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
      />
    </View>
  );
}

// Native video player using expo-av Video component (works on both native and web)
function NativeVideoPlayer({
  video,
  onLoad,
  onError,
  onPlayStateChange,
}: {
  video: VideoItem;
  onLoad: () => void;
  onError: (error: string) => void;
  onPlayStateChange: (playing: boolean) => void;
}) {
  const { Video } = require('expo-av');
  const videoRef = React.useRef<any>(null);
  
  // Get video source - handle require() objects
  // For require(), use it directly; for strings, wrap in { uri: ... }
  const videoSource = typeof video.videoPath === 'object' && video.videoPath
    ? video.videoPath
    : typeof video.videoPath === 'string'
    ? { uri: video.videoPath }
    : video.videoPath;

  React.useEffect(() => {
    if (!videoRef.current) return;

    const statusUpdateListener = videoRef.current.addListener('statusUpdate', (status: any) => {
      if (status.status === 'readyToPlay') {
        onLoad();
        // Auto-play when ready
        videoRef.current?.playAsync();
      } else if (status.status === 'error') {
        const errorMsg = status.error?.message || 'Failed to load video';
        console.error('Video player error:', status.error);
        onError(errorMsg);
      } else if (status.status === 'playing') {
        onPlayStateChange(true);
      } else if (status.status === 'paused' || status.status === 'stopped') {
        onPlayStateChange(false);
      }
    });

    const playbackStatusUpdateListener = videoRef.current.addListener('playbackStatusUpdate', (status: any) => {
      if (status.isPlaying) {
        onPlayStateChange(true);
      } else {
        onPlayStateChange(false);
      }
    });

    return () => {
      statusUpdateListener?.remove();
      playbackStatusUpdateListener?.remove();
    };
  }, [onLoad, onError, onPlayStateChange]);

  return (
    <View style={styles.videoContainer}>
      <Video
        ref={videoRef}
        source={videoSource}
        style={styles.video}
        resizeMode="contain"
        useNativeControls
        shouldPlay={false}
        isLooping={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  introSection: {
    marginBottom: 24,
  },
  introTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  introDescription: {
    fontSize: 16,
    color: '#475569',
    lineHeight: 24,
  },
  videosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
    justifyContent: 'flex-start',
  },
  videoCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  videoThumbnail: {
    width: '100%',
    height: CARD_HEIGHT,
    backgroundColor: '#F1F5F9',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ECF1F5',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  playButtonOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EC4899',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  videoInfo: {
    padding: 12,
  },
  videoTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  videoDescription: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: '#FFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
    marginRight: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
  },
  modalVideoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  videoContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    borderRadius: 0,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 24,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#FFF',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 24,
    backgroundColor: '#EC4899',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  modalInfoSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  modalInfoTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  modalInfoDescription: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
});


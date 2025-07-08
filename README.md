# Therabot - AI Therapy Assistant

A real-time therapy chatbot featuring streaming responses, speech recognition, and thoughtful session management. Built with a focus on mental health support.

## Demo
For a quick demo please check out the video file titled "TherabotPost.mp4"

### Core Functionality
- **Real-time streaming responses** - Words appear as they're generated for natural conversation flow
- **Speech recognition & text-to-speech** - Hands-free interaction with visual audio feedback
- **Session persistence** - Conversations are saved and can be continued later
- **Professional transcript export** - Beautiful formatted session summaries with insights

### 🎨 User Experience
- **Glassmorphism UI** - Modern, calming design perfect for therapy sessions
- **Smooth animations** - Seamless transitions between landing page and chat interface
- **Mobile responsive** - Works beautifully on all devices
- **Accessibility focused** - Screen reader friendly with proper contrast

### 🔧 Technical Highlights
- **Streaming API integration** - Real-time response generation with automatic fallbacks
- **Database modeling** - Sessions, messages, and user data with SQLAlchemy
- **Error handling** - Graceful degradation and comprehensive error recovery
- **Privacy-first design** - Local data storage with secure session management

## 🛠️ Tech Stack

- **Backend**: Flask, SQLAlchemy, SQLite
- **Frontend**: HTML5, CSS3, JavaScript ES6
- **APIs**: Ollama (LLM), Web Speech API, Edge TTS
- **Features**: Real-time streaming, file downloads, session management
- **Design**: Responsive CSS with glassmorphism effects and Lottie animations

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- [Ollama](https://ollama.ai) with Llama3 model installed

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/therabot.git
   cd therabot
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Ollama** (in a separate terminal)
   ```bash
   ollama serve
   ollama pull llama3
   ```

5. **Run the application**
   ```bash
   python app.py
   ```

6. **Open your browser**
   ```
   http://localhost:5000
   ```

## ⚙️ Configuration

### Environment Variables
- `FLASK_SECRET_KEY` - Secret key for session management
- `DATABASE_URL` - Database connection string (defaults to SQLite)
- `OLLAMA_API_URL` - Ollama API endpoint (defaults to localhost:11434)

### Ollama Setup
```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama service
ollama serve

# Download the Llama3 model
ollama pull llama3
```

## 📱 Usage

1. **Start a conversation** - Type or speak your thoughts
2. **Engage naturally** - Therabot responds with empathy and understanding
3. **End your session** - Download a beautiful transcript with insights
4. **Return anytime** - Your session history is preserved

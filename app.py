from flask import Flask, render_template, request, jsonify, session, Response, send_file
from flask_sqlalchemy import SQLAlchemy
import requests
import os
from io import BytesIO
import asyncio
import edge_tts
import json
from datetime import datetime
import uuid
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Try to import zipfile and matplotlib
try:
    import zipfile
    ZIPFILE_AVAILABLE = True
except ImportError:
    print("Zipfile not available - session export will be text only")
    ZIPFILE_AVAILABLE = False

try:
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    print("Matplotlib not installed. Graphs will be skipped.")
    MATPLOTLIB_AVAILABLE = False

# Sentiment analysis imports
try:
    from transformers import pipeline
    sentiment_analyzer = pipeline("sentiment-analysis", 
                                model="cardiffnlp/twitter-roberta-base-sentiment-latest")
    SENTIMENT_AVAILABLE = True
except ImportError:
    print("Transformers not installed. Sentiment analysis will use mock data.")
    SENTIMENT_AVAILABLE = False

app = Flask(__name__)

# Configuration from environment variables
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'default-secret-key-change-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///therabot.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# API Configuration from environment
OLLAMA_API = os.getenv('OLLAMA_API_URL', 'http://localhost:11434/api/generate')

# Database Models
class Session(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_email = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime)
    messages = db.relationship('Message', backref='session', lazy=True, cascade='all, delete-orphan')

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(36), db.ForeignKey('session.id'))
    speaker = db.Column(db.String(20))  # 'user' or 'bot'
    content = db.Column(db.Text)
    sentiment_score = db.Column(db.Float)  # RoBERTa output
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# Initialize database
with app.app_context():
    db.create_all()

def analyze_sentiment(text):
    """Analyze sentiment using RoBERTa model"""
    if not SENTIMENT_AVAILABLE:
        # Mock sentiment for demo purposes
        import random
        return random.uniform(-1, 1)
    
    try:
        result = sentiment_analyzer(text)[0]
        # Convert to numeric score (-1 to 1)
        if result['label'] == 'LABEL_2':  # Positive
            score = result['score']
        elif result['label'] == 'LABEL_0':  # Negative
            score = -result['score']
        else:  # Neutral (LABEL_1)
            score = 0
        return score
    except Exception as e:
        print(f"Sentiment analysis error: {e}")
        return 0

def get_or_create_session():
    """Get current session or create new one"""
    session_id = session.get('session_id')
    if not session_id:
        session_obj = Session()
        db.session.add(session_obj)
        db.session.commit()
        session['session_id'] = session_obj.id
        return session_obj
    
    return Session.query.get(session_id)

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/session/<session_id>')
def restore_session(session_id):
    """Restore previous session from email link"""
    session_obj = Session.query.get_or_404(session_id)
    
    # Load previous messages into current session
    previous_messages = Message.query.filter_by(session_id=session_id).order_by(Message.timestamp).all()
    
    # Convert to session format
    history = []
    for msg in previous_messages:
        speaker = "[USER]" if msg.speaker == 'user' else "[THERABOT]"
        history.append(f"{speaker}: {msg.content}")
    
    session['history'] = history
    session['session_id'] = session_id
    
    return render_template('index.html', 
                         returning_user=True, 
                         previous_session_date=session_obj.created_at.strftime("%B %d, %Y"),
                         session_id=session_id)

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get("message", "")
    history = session.get("history", [])
    
    # Get or create session
    session_obj = get_or_create_session()
    
    # Analyze sentiment of user message
    sentiment_score = analyze_sentiment(user_message)
    
    # Save user message to database
    user_msg = Message(
        session_id=session_obj.id,
        speaker='user',
        content=user_message,
        sentiment_score=sentiment_score
    )
    db.session.add(user_msg)
    
    history.append(f"[USER]: {user_message}")

    prompt = "[INSTRUCTION]: Respond like an empathetic therapist, offering emotionally intelligent guidance.\n"
    prompt += "\n".join(history[-6:])  # last 3 exchanges (user + bot)
    prompt += "\n[THERABOT]:"

    response = requests.post(OLLAMA_API, json={
        "model": "llama3",
        "prompt": prompt,
        "stream": False
    })

    try:
        result = response.json()
        print("USER MESSAGE:", user_message)
        print("OLLAMA RAW RESPONSE:", result)
        reply = result.get("response", "").strip()
        if not reply:
            reply = "Hmm, I didn't quite catch that. Can you say more?"
        
        # Save bot message to database
        bot_msg = Message(
            session_id=session_obj.id,
            speaker='bot',
            content=reply,
            sentiment_score=0  # Bot messages don't have sentiment
        )
        db.session.add(bot_msg)
        db.session.commit()
        
        history.append(f"[THERABOT]: {reply}")
        session["history"] = history
    except Exception as e:
        print("Error from Ollama:", e)
        reply = "Sorry, I had trouble processing that."

    return jsonify({"reply": reply.strip()})

@app.route('/chat-stream', methods=['POST'])
def chat_stream():
    """New streaming endpoint for faster responses"""
    user_message = request.json.get("message", "")
    history = session.get("history", [])
    
    # Get or create session
    session_obj = get_or_create_session()
    
    # Analyze sentiment of user message
    sentiment_score = analyze_sentiment(user_message)
    
    # Save user message to database
    user_msg = Message(
        session_id=session_obj.id,
        speaker='user',
        content=user_message,
        sentiment_score=sentiment_score
    )
    db.session.add(user_msg)
    db.session.commit()
    
    history.append(f"[USER]: {user_message}")

    prompt = "[INSTRUCTION]: Respond like an empathetic therapist, offering emotionally intelligent guidance.\n"
    prompt += "\n".join(history[-6:])  # last 3 exchanges (user + bot)
    prompt += "\n[THERABOT]:"

    def generate():
        try:
            # Make streaming request to Ollama
            response = requests.post(OLLAMA_API, json={
                "model": "llama3",
                "prompt": prompt,
                "stream": True  # Enable streaming!
            }, stream=True)

            full_response = ""
            
            for line in response.iter_lines():
                if line:
                    try:
                        # Parse each JSON chunk from Ollama
                        chunk_data = json.loads(line.decode('utf-8'))
                        
                        if 'response' in chunk_data:
                            content = chunk_data['response']
                            if content:
                                full_response += content
                                # Send each chunk to the frontend
                                yield f"data: {content}\n\n"
                        
                        # Check if this is the final chunk
                        if chunk_data.get('done', False):
                            break
                            
                    except json.JSONDecodeError:
                        continue
            
            # Save the complete response to session history and database
            if full_response.strip():
                bot_msg = Message(
                    session_id=session_obj.id,
                    speaker='bot',
                    content=full_response.strip(),
                    sentiment_score=0  # Bot messages don't have sentiment
                )
                db.session.add(bot_msg)
                db.session.commit()
                
                history.append(f"[THERABOT]: {full_response.strip()}")
                session["history"] = history
            
            # Signal completion
            yield "data: [DONE]\n\n"
            
        except Exception as e:
            print(f"Streaming error: {e}")
            # Fallback response
            error_response = "I'm having trouble right now, but I'm here to listen. Can you tell me more?"
            
            bot_msg = Message(
                session_id=session_obj.id,
                speaker='bot',
                content=error_response,
                sentiment_score=0
            )
            db.session.add(bot_msg)
            db.session.commit()
            
            history.append(f"[THERABOT]: {error_response}")
            session["history"] = history
            yield f"data: {error_response}\n\n"
            yield "data: [DONE]\n\n"

    return Response(generate(), mimetype='text/plain')

@app.route('/start-session', methods=['POST'])
def start_session():
    """Start a new session with email"""
    email = request.json.get('email')
    
    session_obj = get_or_create_session()
    if email:
        session_obj.user_email = email
        db.session.commit()
    
    return jsonify({'session_id': session_obj.id})

@app.route('/end-session', methods=['POST'])
def end_session():
    """End current session and download beautiful text transcript"""
    print("=== END SESSION REQUEST RECEIVED ===")
    
    try:
        session_id = session.get('session_id')
        print(f"Session ID: {session_id}")
        
        if not session_id:
            print("No session ID found - creating simple transcript")
            # Even without session, create a basic transcript
            simple_transcript = f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                           THERABOT SESSION SUMMARY                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

📅 Session Date: {datetime.utcnow().strftime("%A, %B %d, %Y")}
⏰ Session Time: {datetime.utcnow().strftime("%I:%M %p")}

Thank you for visiting Therabot! 

Even though we didn't have a full conversation, taking the step to seek support 
shows strength and self-awareness.

💙 REMEMBER:
• Your mental health matters
• Every small step counts
• You're not alone on this journey

🤖 Therabot - Your AI Therapy Assistant
"""
            text_buffer = BytesIO(simple_transcript.encode('utf-8'))
            text_buffer.seek(0)
            session.clear()
            
            return send_file(
                text_buffer,
                as_attachment=True,
                download_name=f'therabot_visit_{datetime.utcnow().strftime("%Y%m%d_%H%M")}.txt',
                mimetype='text/plain'
            )
        
        # Get session and update end time
        session_obj = Session.query.get(session_id)
        if not session_obj:
            print(f"Session not found: {session_id}")
            session.clear()
            return jsonify({'error': 'Session not found'}), 404
        
        print(f"Found session: {session_obj.id}")
        
        session_obj.ended_at = datetime.utcnow()
        db.session.commit()
        print("Session updated and committed to database")
        
        # Create beautiful transcript
        transcript = create_session_transcript(session_obj)
        
        # Create text file
        text_buffer = BytesIO(transcript.encode('utf-8'))
        text_buffer.seek(0)
        
        # Clear current session
        session.clear()
        print("Session cleared")
        
        filename = f'therabot_session_{session_obj.created_at.strftime("%Y%m%d_%H%M")}.txt'
        print(f"Returning transcript: {filename}")
        
        return send_file(
            text_buffer,
            as_attachment=True,
            download_name=filename,
            mimetype='text/plain'
        )
        
    except Exception as e:
        print(f"ERROR in end_session: {e}")
        import traceback
        traceback.print_exc()
        
        # Emergency fallback - always return something
        try:
            emergency_transcript = f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                           THERABOT SESSION SUMMARY                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

⚠️  There was an issue creating your full session summary, but we wanted to make 
    sure you got something meaningful from your time with Therabot.

📅 Session Date: {datetime.utcnow().strftime("%A, %B %d, %Y")}
⏰ End Time: {datetime.utcnow().strftime("%I:%M %p")}

💭 IMPORTANT MESSAGE:
Your decision to engage with mental health support today shows incredible strength 
and self-awareness. Even when technology doesn't work perfectly, your commitment 
to your wellbeing is what truly matters.

💙 REMEMBER:
• Every conversation about mental health is meaningful
• You took a positive step today
• Professional support is always available when needed
• You're not alone on this journey

Keep taking care of yourself. You matter.

🤖 Therabot - Your AI Therapy Assistant
"""
            emergency_buffer = BytesIO(emergency_transcript.encode('utf-8'))
            emergency_buffer.seek(0)
            session.clear()
            
            return send_file(
                emergency_buffer,
                as_attachment=True,
                download_name=f'therabot_session_{datetime.utcnow().strftime("%Y%m%d_%H%M")}.txt',
                mimetype='text/plain'
            )
        except:
            # Last resort - JSON response
            session.clear()
            return jsonify({'message': 'Session ended successfully. Thank you for using Therabot!'}), 200

def create_session_transcript(session_obj):
    """Create a simple, beautiful text transcript of the session"""
    
    # Get all messages for this session
    messages = Message.query.filter_by(session_id=session_obj.id).order_by(Message.timestamp).all()
    
    # Calculate session stats
    duration_minutes = 0
    if session_obj.ended_at:
        duration_minutes = (session_obj.ended_at - session_obj.created_at).total_seconds() / 60
    
    user_messages = [msg for msg in messages if msg.speaker == 'user']
    
    # Calculate simple sentiment summary
    sentiments = [msg.sentiment_score for msg in user_messages if msg.sentiment_score is not None]
    if sentiments:
        avg_sentiment = sum(sentiments) / len(sentiments)
        if avg_sentiment > 0.1:
            mood_summary = "Generally Positive"
        elif avg_sentiment < -0.1:
            mood_summary = "Reflective & Processing"
        else:
            mood_summary = "Balanced & Thoughtful"
    else:
        mood_summary = "Engaged & Open"
    
    # Create beautiful transcript
    transcript = f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                           THERABOT SESSION SUMMARY                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

📅 Session Date: {session_obj.created_at.strftime("%A, %B %d, %Y")}
⏰ Session Time: {session_obj.created_at.strftime("%I:%M %p")} - {session_obj.ended_at.strftime("%I:%M %p") if session_obj.ended_at else "Ongoing"}
⏱️  Duration: {duration_minutes:.0f} minutes
💬 Messages Exchanged: {len(messages)}
🎭 Overall Mood: {mood_summary}

{'='*80}
                                CONVERSATION
{'='*80}
"""

    if len(messages) > 0:
        for i, msg in enumerate(messages, 1):
            speaker = "You" if msg.speaker == 'user' else "Therabot"
            time = msg.timestamp.strftime("%H:%M")
            
            # Add some visual separation
            if speaker == "You":
                transcript += f"\n[{time}] 👤 YOU:\n"
                transcript += f"{msg.content}\n"
            else:
                transcript += f"\n[{time}] 🤖 THERABOT:\n"
                transcript += f"{msg.content}\n"
            
            # Add a subtle separator between exchanges
            if i < len(messages):
                transcript += f"{'-'*40}\n"
    else:
        transcript += "\nNo messages were recorded in this session.\n"
    
    transcript += f"""

{'='*80}
                              SESSION INSIGHTS
{'='*80}

🌱 REFLECTION:
This conversation represents a meaningful step in your mental health journey. 
Taking time to express your thoughts and feelings shows incredible self-awareness 
and strength.

💭 KEY MOMENTS:
• You engaged in {len(user_messages)} thoughtful exchanges
• Your willingness to share shows courage and openness
• Each message is part of your ongoing path toward wellness

🎯 MOVING FORWARD:
Remember that healing isn't linear, and every feeling you experienced today is 
valid. You're building important skills in self-reflection and emotional awareness.

💙 GENTLE REMINDER:
• Your mental health matters
• It's okay to have difficult days
• Professional support is always available when needed
• You're not alone on this journey
• Every conversation is progress

{'='*80}

Thank you for trusting Therabot with your thoughts today. Take care of yourself!

Generated on {datetime.utcnow().strftime("%B %d, %Y at %I:%M %p")}
Session ID: {session_obj.id}

🤖 Therabot - Your AI Therapy Assistant
"""

    return transcript

@app.route("/tts", methods=["POST"])
def tts():
    text = request.json.get("text", "")
    print(f"Text to convert: '{text}'")
    if not text:
        return jsonify({"error": "Missing text"}), 400

    async def generate():
        communicate = edge_tts.Communicate(
            text, 
            voice="en-US-GuyNeural",
            rate="+30%"  # speed it up!
        )
        mp3_fp = BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_fp.write(chunk["data"])
        mp3_fp.seek(0)
        return send_file(mp3_fp, mimetype="audio/mpeg")

    try:
        return asyncio.run(generate())
    except Exception as e:
        print(f"ERROR: Edge TTS failure: {e}")
        return jsonify({"error": f"TTS error: {e}"}), 500
    
@app.route('/chat/reset', methods=['POST'])
def reset_chat():
    session.clear()
    return '', 204

if __name__ == '__main__':
    app.run(debug=True)
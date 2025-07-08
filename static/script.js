let currentAudio = null;
let isExpanded = false;
let animation = null;
let currentBotMessage = null;

// Chat data for export
let chatHistory = [];

function expandToChat() {
    console.log("Expanding to chat, isExpanded:", isExpanded);
    if (!isExpanded) {
        const container = document.querySelector('.container');
        container.classList.remove('initial');
        isExpanded = true;
        console.log("Chat expanded");
    }
}

function startConversation() {
    const initialInput = document.querySelector('.initial-msg');
    const text = initialInput.value.trim();
    
    console.log("Start conversation called with text:", text);
    
    expandToChat();
    
    // Wait for animation to complete, then send message
    setTimeout(() => {
        if (text) {
            document.getElementById('msg').value = text;
            sendMessage();
        } else {
            // If no text, just expand the chat
            console.log("No text provided, just expanding chat");
        }
    }, 900);
}

function startListeningInitial() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert("Speech recognition not supported in this browser");
        return;
    }

    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const speakButton = document.querySelector('button[onclick="startListeningInitial()"]');
    const inputArea = document.querySelector('.initial-input');
    speakButton.classList.add('recording');
    inputArea.classList.add('listening');

    // Create audio visualizer bars
    const visualizer = document.getElementById('audioVisualizerInitial');
    visualizer.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const bar = document.createElement('div');
        bar.className = 'audio-bar';
        bar.style.height = '10px';
        visualizer.appendChild(bar);
    }

    // Animate bars
    const animateInterval = setInterval(() => {
        const bars = visualizer.querySelectorAll('.audio-bar');
        bars.forEach(bar => {
            const height = Math.random() * 40 + 10;
            bar.style.height = height + 'px';
        });
    }, 100);

    recognition.onstart = function() {
        setStatus("Listening...");
    };

    recognition.onend = function() {
        setStatus("");
        speakButton.classList.remove('recording');
        inputArea.classList.remove('listening');
        clearInterval(animateInterval);
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.querySelector('.initial-msg').value = transcript;
        setTimeout(() => startConversation(), 500);
    };

    recognition.onerror = function(event) {
        console.error("Speech recognition error:", event.error);
        setStatus("Speech recognition error: " + event.error);
        speakButton.classList.remove('recording');
        inputArea.classList.remove('listening');
        clearInterval(animateInterval);
    };

    recognition.start();
}

function setStatus(message) {
    const statusElement = document.getElementById("status");
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function stopSpeech() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        stopTalking();
        setStatus("");
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.style.display = 'none';
        }
    }
}

async function speakText(text) {
    try {
        setStatus("Generating speech...");
        
        const response = await fetch('/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`TTS failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        stopSpeech();
        
        currentAudio = new Audio(audioUrl);
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.style.display = 'inline-block';
        }
        
        currentAudio.onloadstart = () => {
            setStatus("Loading audio...");
        };
        
        currentAudio.oncanplay = () => {
            setStatus("Speaking...");
            startTalking();
            currentAudio.play();
        };
        
        currentAudio.onended = () => {
            stopTalking();
            setStatus("");
            if (stopBtn) {
                stopBtn.style.display = 'none';
            }
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
        };
        
        currentAudio.onerror = () => {
            setStatus("Audio playback error");
            if (stopBtn) {
                stopBtn.style.display = 'none';
            }
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
        };

    } catch (error) {
        console.error('TTS Error:', error);
        setStatus("Speech generation failed: " + error.message);
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.style.display = 'none';
        }
    }
}

// Enhanced sendMessage with streaming support
async function sendMessage() {
    console.log("SendMessage called, isExpanded:", isExpanded);
    
    if (!isExpanded) {
        console.log("Not expanded, expanding first...");
        expandToChat();
        setTimeout(() => sendMessage(), 800);
        return;
    }

    const input = document.getElementById("msg");
    const text = input.value.trim();
    console.log("Sending message:", text);
    
    if (!text) {
        console.log("No text to send");
        return;
    }

    const chat = document.getElementById("chat");
    const wasScrolledToBottom = chat.scrollHeight - chat.clientHeight <= chat.scrollTop + 1;
    
    // Add user message to chat and history
    const userMessageData = {
        type: 'user',
        message: text,
        timestamp: new Date().toISOString()
    };
    chatHistory.push(userMessageData);

    chat.innerHTML += `
        <div class="message user-message">
            <div>
                <strong>You:</strong><br>${text}
            </div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
    `;
    input.value = "";

    // Auto-scroll if user was at bottom
    if (wasScrolledToBottom) {
        chat.scrollTop = chat.scrollHeight;
    }

    setStatus("Thinking...");
    document.getElementById("typing-indicator").style.display = "flex";
    console.log("Showing typing indicator");

    try {
        // Try streaming first, fallback to regular if not available
        const isStreamingSupported = await tryStreamingResponse(text, chat);
        
        if (!isStreamingSupported) {
            // Fallback to regular response
            await sendRegularMessage(text, chat);
        }

    } catch (err) {
        console.error("Full sendMessage error:", err);
        setStatus("Error occurred");
        document.getElementById("typing-indicator").style.display = "none";
    }
}

// Try streaming response
async function tryStreamingResponse(text, chat) {
    try {
        const response = await fetch("/chat-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text })
        });

        if (!response.ok) {
            console.log("Streaming not available, falling back to regular");
            return false;
        }

        document.getElementById("typing-indicator").style.display = "none";
        
        // Create bot message container with streaming indicator
        const botMessageDiv = document.createElement('div');
        botMessageDiv.className = 'message bot-message streaming';
        botMessageDiv.innerHTML = `
            <div>
                <strong>Therabot:</strong><br><span class="bot-text"></span>
            </div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        `;
        chat.appendChild(botMessageDiv);
        currentBotMessage = botMessageDiv.querySelector('.bot-text');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const content = line.slice(6);
                    if (content.trim() && content !== '[DONE]') {
                        fullResponse += content;
                        currentBotMessage.textContent = fullResponse;
                        chat.scrollTop = chat.scrollHeight;
                    }
                }
            }
        }

        // Remove streaming indicator
        botMessageDiv.classList.remove('streaming');
        
        // Add to chat history
        const botMessageData = {
            type: 'bot',
            message: fullResponse,
            timestamp: new Date().toISOString()
        };
        chatHistory.push(botMessageData);

        // Use TTS for speech
        await speakText(fullResponse);
        
        return true;

    } catch (error) {
        console.error("Streaming error:", error);
        return false;
    }
}

// Regular message sending (fallback)
async function sendRegularMessage(text, chat) {
    const chatRes = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
    });

    if (!chatRes.ok) {
        console.error("Chat response failed:", await chatRes.text());
        setStatus("Chat failed");
        document.getElementById("typing-indicator").style.display = "none";
        return;
    }

    const chatData = await chatRes.json();
    const wasScrolledToBottomBeforeReply = chat.scrollHeight - chat.clientHeight <= chat.scrollTop + 1;
    
    // Add to chat history
    const botMessageData = {
        type: 'bot',
        message: chatData.reply,
        timestamp: new Date().toISOString()
    };
    chatHistory.push(botMessageData);

    chat.innerHTML += `
        <div class="message bot-message">
            <div>
                <strong>Therabot:</strong><br>${chatData.reply}
            </div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
    `;
    
    // Auto-scroll if user was at bottom
    if (wasScrolledToBottomBeforeReply) {
        chat.scrollTop = chat.scrollHeight;
    }
    
    document.getElementById("typing-indicator").style.display = "none";
    console.log("Hiding typing indicator");

    // Use TTS for speech
    await speakText(chatData.reply);
}

// Chat export functionality
function exportChat() {
    if (chatHistory.length === 0) {
        alert("No conversation to export yet. Start chatting first!");
        return;
    }

    const exportData = {
        sessionDate: new Date().toLocaleDateString(),
        sessionTime: new Date().toLocaleTimeString(),
        messageCount: chatHistory.length,
        conversation: chatHistory
    };

    // Create formatted text version
    let textContent = `Therabot Session Summary\n`;
    textContent += `Date: ${exportData.sessionDate}\n`;
    textContent += `Time: ${exportData.sessionTime}\n`;
    textContent += `Messages: ${exportData.messageCount}\n`;
    textContent += `\n${'='.repeat(50)}\n\n`;

    chatHistory.forEach((msg, index) => {
        const speaker = msg.type === 'user' ? 'You' : 'Therabot';
        const time = new Date(msg.timestamp).toLocaleTimeString();
        textContent += `[${time}] ${speaker}: ${msg.message}\n\n`;
    });

    // Create and download file
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `therabot-session-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("Chat exported successfully!");
    setTimeout(() => setStatus(""), 3000);
}

// Session management functions
function showEndSessionModal() {
    const modal = document.getElementById('endSessionModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function hideEndSessionModal() {
    const modal = document.getElementById('endSessionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function hideWelcomeBackModal() {
    const modal = document.getElementById('welcomeBackModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function confirmEndSession() {
    console.log('confirmEndSession called');
    
    try {
        setStatus("Ending session and preparing download...");
        
        console.log('Sending request to /end-session');
        
        const response = await fetch('/end-session', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            }
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', [...response.headers.entries()]);
        
        if (response.ok) {
            hideEndSessionModal();
            
            // Check if response is a file download
            const contentType = response.headers.get('content-type');
            console.log('Content-Type:', contentType);
            
            if (contentType && (contentType.includes('text/plain') || contentType.includes('application/octet-stream'))) {
                // Handle file download
                console.log('Downloading file...');
                const blob = await response.blob();
                console.log('Blob size:', blob.size);
                
                const url = window.URL.createObjectURL(blob);
                
                // Extract filename from Content-Disposition header or use default
                let filename = 'therabot_session.txt';
                const disposition = response.headers.get('Content-Disposition');
                console.log('Content-Disposition:', disposition);
                
                if (disposition && disposition.includes('filename=')) {
                    filename = disposition.split('filename=')[1].replace(/"/g, '');
                }
                
                // Create download link
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                alert(`🎉 Session ended successfully!\n\nYour session transcript has been downloaded:\n• Complete conversation with beautiful formatting\n• Session insights and mood summary\n• Thoughtful encouragement and reflection\n\nThank you for taking care of your mental health today!`);
            } else {
                // Handle text/JSON response (fallback)
                console.log('Handling text response...');
                const responseText = await response.text();
                console.log('Response text:', responseText);
                
                try {
                    const result = JSON.parse(responseText);
                    alert(`🎉 Session ended successfully!\n\n${result.message || 'Session completed'}\n\nThank you for taking care of your mental health today!`);
                } catch (parseError) {
                    console.log('Not JSON, treating as plain text');
                    alert(`🎉 Session ended successfully!\n\nThank you for taking care of your mental health today!`);
                }
            }
            
            // Clear chat and reset to initial state
            setTimeout(() => {
                location.reload();
            }, 2000);
        } else {
            // Try to parse error response
            const responseText = await response.text();
            console.error('Error response:', responseText);
            
            try {
                const result = JSON.parse(responseText);
                alert(`Error ending session: ${result.error || 'Unknown error occurred'}`);
            } catch (parseError) {
                alert(`Error ending session: ${response.status} - ${responseText}`);
            }
        }
    } catch (error) {
        console.error('End session error details:', error);
        
        // Provide more specific error messages
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            alert('Network error: Could not connect to server. Please check your connection and try again.');
        } else {
            alert(`Failed to end session: ${error.message}\n\nPlease try again, or refresh the page if the problem continues.`);
        }
    } finally {
        setStatus("");
    }
}

function startListening() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert("Speech recognition not supported in this browser");
        return;
    }

    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const speakButton = document.querySelector('button[onclick="startListening()"]');
    const inputArea = document.querySelector('.input-area');
    
    if (speakButton) speakButton.classList.add('recording');
    if (inputArea) inputArea.classList.add('listening');

    // Create audio visualizer bars
    const visualizer = document.getElementById('audioVisualizer');
    if (visualizer) {
        visualizer.innerHTML = '';
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'audio-bar';
            bar.style.height = '10px';
            visualizer.appendChild(bar);
        }

        // Animate bars
        const animateInterval = setInterval(() => {
            const bars = visualizer.querySelectorAll('.audio-bar');
            bars.forEach(bar => {
                const height = Math.random() * 40 + 10;
                bar.style.height = height + 'px';
            });
        }, 100);

        recognition.onend = function() {
            setStatus("");
            if (speakButton) speakButton.classList.remove('recording');
            if (inputArea) inputArea.classList.remove('listening');
            clearInterval(animateInterval);
        };
    }

    recognition.onstart = function() {
        setStatus("Listening...");
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        const msgInput = document.getElementById("msg");
        if (msgInput) {
            msgInput.value = transcript;
            setTimeout(() => sendMessage(), 500);
        }
    };

    recognition.onerror = function(event) {
        console.error("Speech recognition error:", event.error);
        setStatus("Speech recognition error: " + event.error);
        if (speakButton) speakButton.classList.remove('recording');
        if (inputArea) inputArea.classList.remove('listening');
    };

    recognition.start();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    // Enter key support
    const msgInput = document.getElementById("msg");
    const initialMsgInput = document.querySelector(".initial-msg");
    
    if (msgInput) {
        msgInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                sendMessage();
            }
        });
    }

    if (initialMsgInput) {
        initialMsgInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                startConversation();
            }
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        const endSessionModal = document.getElementById('endSessionModal');
        const welcomeBackModal = document.getElementById('welcomeBackModal');
        
        if (event.target === endSessionModal) {
            hideEndSessionModal();
        }
        if (event.target === welcomeBackModal) {
            hideWelcomeBackModal();
        }
    });

    // ESC key to close modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            hideEndSessionModal();
            hideWelcomeBackModal();
        }
    });
});

// Load Lottie animation and initialize page
window.addEventListener("load", async () => {
    console.log('Window loaded');
    
    try {
        // Initialize Lottie animation
        if (typeof lottie !== 'undefined') {
            const avatarContainer = document.getElementById("therapist-avatar");
            if (avatarContainer) {
                animation = lottie.loadAnimation({
                    container: avatarContainer,
                    renderer: "svg",
                    loop: true,
                    autoplay: false,
                    path: "/static/talking_avatar.json"
                });
                console.log("Lottie animation loaded successfully");
            }
        } else {
            console.warn("Lottie library not loaded, using fallback emoji");
        }
        
        // Reset session memory for new sessions
        if (!window.location.pathname.includes('/session/')) {
            try {
                await fetch("/chat/reset", { method: "POST" });
                console.log("Session reset successful");
            } catch (resetError) {
                console.warn("Session reset failed:", resetError);
            }
        }
        
        // Initialize chat history
        chatHistory = [];
        
    } catch (e) {
        console.error("Failed to initialize:", e);
    }
});

function startTalking() {
    if (animation) {
        animation.goToAndPlay(0, true);
    } else {
        console.log("Would start talking animation");
    }
}

function stopTalking() {
    if (animation) {
        animation.stop();
    } else {
        console.log("Would stop talking animation");
    }
}
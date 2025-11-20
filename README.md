# HandyMQTT

A lightweight and user-friendly MQTT client built with **Angular** and **Electron**, designed specifically for developers to debug and test MQTT connections efficiently.

## 🚀 Features

- **Multi-Connection Management**: Create and manage multiple MQTT client connections simultaneously with a tabbed interface
- **Send to Topics**: Configure and send messages to MQTT topics with QoS and retain options
- **Subscribe to Topics**: Subscribe to multiple topics and view incoming messages in real-time
- **Message Editor**: Create, edit, and manage multiple message templates for quick testing
- **Local Storage**: All configurations, topics, subscriptions, and messages are automatically saved locally
- **Certificate Authentication**: Support for SSL/TLS and self-signed certificate authentication
- **JSON Formatting**: Built-in JSON formatter for message payloads
- **Drag & Drop**: Reorder topics, subscriptions, and message editors with intuitive drag-and-drop
- **Cross-Platform**: Available for Windows, macOS, and Linux

## 📥 Download

Download the latest version for your platform:

- **Windows**: [Download HandyMQTT for Windows](https://github.com/AaronWang/HandyMqtt/releases)
- **macOS**: [Download HandyMQTT for macOS](https://github.com/AaronWang/HandyMqtt/releases)
- **Linux**: [Download HandyMQTT for Linux](https://github.com/AaronWang/HandyMqtt/releases)

Visit the [Releases](https://github.com/AaronWang/HandyMqtt/releases) page for all available versions.

## 🛠️ Technology Stack

- **Frontend**: Angular 17 with standalone components
- **Desktop**: Electron 39
- **Language**: TypeScript 5.2
- **Styling**: SCSS

## 🏃 Development

### Prerequisites

- Node.js v22.17.0
- npm v10.9.2

### Installation

```bash
# Clone the repository
git clone https://github.com/AaronWang/HandyMqtt.git
cd HandyMqtt

# Install dependencies
npm install
```

### Run in Development Mode

```bash
# Start the Electron app with hot reload
npm run electron:dev
```

### Build for Production

```bash
# Build the application for your platform
npm run package
```

The built application will be available in the `release/` directory.

## 📖 Usage

1. **Create a New Connection**: Click the "New MQTT Client" button to configure a new MQTT broker connection
2. **Add Send Topics**: Add topics you want to publish messages to
3. **Subscribe to Topics**: Subscribe to topics to receive messages
4. **Create Message Templates**: Use the Message Editor to create reusable message templates
5. **Send Messages**: Select a message editor and click "Send" to publish your message

All your configurations are automatically saved and will be restored when you reopen the application.

## 💖 Support & Donation

If you find HandyMQTT helpful for your development work, consider supporting the project!

**Buy me a coffee** ☕

- PayID: **wrq3530@gmail.com**

Your support helps keep this project maintained and improved. Thank you! 🙏

## 📧 Contact

If you have any questions, feature requests, or bug reports, feel free to reach out:

- **Email**: wrq3530@gmail.com
- **Issues**: [GitHub Issues](https://github.com/AaronWang/HandyMqtt/issues)

## 📄 License

This project is licensed under the MIT License.

## 🙌 Acknowledgments

Built with ❤️ using Angular and Electron to make MQTT debugging easier for developers worldwide.

---

**Happy Debugging! 🐛🔧**

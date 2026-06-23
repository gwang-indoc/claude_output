# claude_output

Real-time streaming viewer for Claude session content.  
Send a prompt and watch the response appear token-by-token in your browser via Server-Sent Events.

## Quick start

1. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

2. **Set your API key**

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   # or add it to a .env file:
   echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
   ```

3. **Start the server**

   ```bash
   uvicorn main:app --reload
   ```

4. **Open the viewer**

   Navigate to <http://localhost:8000> in your browser, type a prompt, and click **Send ▶**.

## API

### `POST /stream`

Stream a Claude response via Server-Sent Events.

**Request body (JSON)**

| Field        | Type   | Default                      | Description                    |
|--------------|--------|------------------------------|--------------------------------|
| `prompt`     | string | *(required)*                 | User message                   |
| `model`      | string | `claude-opus-4-5`            | Claude model ID                |
| `system`     | string | `You are a helpful assistant.` | System prompt                |
| `max_tokens` | int    | `4096`                       | Maximum tokens to generate     |

**SSE events**

| Event   | Data fields                                   | Description                        |
|---------|-----------------------------------------------|------------------------------------|
| `delta` | `text`                                        | Incremental text chunk             |
| `done`  | `input_tokens`, `output_tokens`, `stop_reason` | Stream finished                   |
| `error` | `message`                                     | An error occurred                  |

**Example**

```bash
curl -N -X POST http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tell me a short joke."}'
```

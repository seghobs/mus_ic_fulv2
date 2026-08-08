import json
import re
from google import genai
from google.genai import types
from .gemini_config import API_KEY, TEXT_MODEL, _text_config, call_with_timeout

def generate_lyrics(topic, style_input=""):
    def _do():
        client = genai.Client(api_key=API_KEY)
        model = TEXT_MODEL

        prompt = f"""Sen Musicful AI için çalışan profesyonel ve ödüllü bir şarkı sözü yazarısın.
Kullanıcı şu konuda bir şarkı istiyor: "{topic}"
İstediği tarz/stil ipucu (opsiyonel): "{style_input}"

Lütfen bu bilgilere dayanarak Musicful AI'a girdiğinde mükemmel sonuç verecek bir şarkı tasarla.

Çıktıyı kesinlikle aşağıdaki JSON formatında ver. Başka hiçbir açıklama, markdown kodu veya tırnak işareti dışında metin ekleme. Sadece geçerli bir JSON döndür.

FORMAT:
{{
  "title": "[Yaratıcı ve dikkat çekici şarkı adı]",
  "lyrics": "[Şarkı sözleri. Kıta, Koro, Köprü başlıkları ile düzenli, akıcı, uyaklı, duygusal ve güçlü sözler yaz. En az 2 kıta ve 1 koro içersin.]",
  "style": "[Şarkı için en uygun Musicful AI tarz etiketleri. Virgülle ayrılmış 2-3 kelime. Örn: 'Acoustic, Pop, Emotional' veya 'Synthwave, Melodic, Energetic']"
}}
"""
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        config = _text_config()
        response_text = ""
        for chunk in client.models.generate_content_stream(model=model, contents=contents, config=config):
            if chunk.text: response_text += chunk.text
        
        text = response_text.strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        try:
            parsed = json.loads(text)
            return parsed
        except Exception:
            title_m = re.search(r'"title"\s*:\s*"(.*?)"', text, re.DOTALL)
            lyrics_m = re.search(r'"lyrics"\s*:\s*"(.*?)"', text, re.DOTALL)
            style_m = re.search(r'"style"\s*:\s*"(.*?)"', text, re.DOTALL)
            
            title = title_m.group(1) if title_m else "Yeni Şarkı"
            lyrics = lyrics_m.group(1) if lyrics_m else "Yapay zeka ile üretilen sözler..."
            style = style_m.group(1) if style_m else "Pop"
            
            lyrics = lyrics.replace("\\n", "\n").replace('\\"', '"')
            
            return {
                "title": title,
                "lyrics": lyrics,
                "style": style
            }

    return call_with_timeout(_do, timeout=120)

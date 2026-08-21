import aiohttp
import asyncio

class MockResponse:
    def __init__(self, status_code, content, text, json_data, headers=None):
        self.status_code = status_code
        self.content = content
        self.text = text
        self._json = json_data
        self.headers = headers or {}
        
    def json(self):
        return self._json

class MockTimeoutResponse:
    def __init__(self, error_msg):
        self.status_code = 504
        self._msg = error_msg
        self.content = b""
        self.text = ""
        self.headers = {}
        
    def json(self):
        return {"error": self._msg, "status": 504, "code": 504, "data": {}}

class AiohttpSyncClient:
    @staticmethod
    async def _request_async(method, url, **kwargs):
        headers = kwargs.get("headers")
        params = kwargs.get("params")
        data = kwargs.get("data")
        json_payload = kwargs.get("json")
        files = kwargs.get("files")
        
        # SSL Verification
        ssl_val = True
        if "verify" in kwargs and kwargs["verify"] is False:
            ssl_val = False
            
        # Timeout
        timeout_val = kwargs.get("timeout", 25)
        timeout = aiohttp.ClientTimeout(total=timeout_val)
        
        async with aiohttp.ClientSession() as session:
            # Handle files (multipart/form-data)
            if files:
                form = aiohttp.FormData()
                for key, val in files.items():
                    if isinstance(val, tuple):
                        filename = val[0]
                        file_bytes = val[1]
                        content_type = val[2] if len(val) > 2 else None
                        form.add_field(key, file_bytes, filename=filename, content_type=content_type)
                    else:
                        form.add_field(key, val)
                
                # Delete manual Content-Type to allow FormData to generate its own boundary
                if headers:
                    headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
                
                req_data = form
            else:
                req_data = data
                
            async with session.request(
                method, 
                url, 
                headers=headers, 
                params=params, 
                data=req_data, 
                json=json_payload, 
                timeout=timeout,
                ssl=ssl_val
            ) as response:
                try:
                    json_data = await response.json()
                except Exception:
                    try:
                        json_data = await response.json(content_type=None)
                    except:
                        json_data = {}
                        
                text_content = await response.text()
                bytes_content = await response.read()
                
                return MockResponse(
                    status_code=response.status,
                    content=bytes_content,
                    text=text_content,
                    json_data=json_data,
                    headers=dict(response.headers)
                )

    @classmethod
    def get(cls, url, *args, **kwargs):
        kwargs.pop("impersonate", None)
        try:
            return asyncio.run(cls._request_async("GET", url, **kwargs))
        except Exception as e:
            print(f"[AiohttpSyncClient GET Error] {url}: {e}")
            return MockTimeoutResponse(str(e))

    @classmethod
    def post(cls, url, *args, **kwargs):
        kwargs.pop("impersonate", None)
        try:
            return asyncio.run(cls._request_async("POST", url, **kwargs))
        except Exception as e:
            print(f"[AiohttpSyncClient POST Error] {url}: {e}")
            return MockTimeoutResponse(str(e))

    @classmethod
    def head(cls, url, *args, **kwargs):
        kwargs.pop("impersonate", None)
        try:
            return asyncio.run(cls._request_async("HEAD", url, **kwargs))
        except Exception as e:
            print(f"[AiohttpSyncClient HEAD Error] {url}: {e}")
            return MockTimeoutResponse(str(e))

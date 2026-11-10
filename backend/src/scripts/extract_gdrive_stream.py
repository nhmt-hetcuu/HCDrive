import sys
import json
import time
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

def get_chrome_binary():
    candidates = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

def get_chromedriver_binary():
    candidates = [
        '/usr/bin/chromedriver',
        '/usr/local/bin/chromedriver'
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "file_id argument required"}))
        sys.exit(1)

    file_id = sys.argv[1].strip()
    raw_cookie_str = sys.stdin.read().strip()

    if not raw_cookie_str:
        print(json.dumps({"ok": False, "error": "No cookie provided on stdin"}))
        sys.exit(1)

    chrome_bin = get_chrome_binary()
    driver_bin = get_chromedriver_binary()

    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--disable-software-rasterizer')
    options.add_argument('--blink-settings=imagesEnabled=false')
    options.add_argument('--window-size=1280,720')
    if chrome_bin:
        options.binary_location = chrome_bin
    options.set_capability('goog:loggingPrefs', {'performance': 'ALL'})

    service = Service(executable_path=driver_bin) if driver_bin else Service()

    driver = None
    try:
        driver = webdriver.Chrome(service=service, options=options)
        driver.set_page_load_timeout(15)
        driver.execute_cdp_cmd('Network.enable', {})

        # Inject cookies
        for pair in raw_cookie_str.split(';'):
            pair = pair.strip()
            if '=' in pair:
                name, val = pair.split('=', 1)
                name = name.strip()
                val = val.strip()
                if name and val:
                    domain = 'drive.google.com' if 'OSID' in name else '.google.com'
                    try:
                        driver.execute_cdp_cmd('Network.setCookie', {
                            'name': name,
                            'value': val,
                            'domain': domain,
                            'path': '/',
                            'secure': True
                        })
                    except Exception:
                        pass

        preview_url = f'https://drive.google.com/file/d/{file_id}/preview'
        driver.get(preview_url)

        # Poll performance logs for up to 6 seconds to capture workspacevideo playback response
        playback_data = None
        user_agent = None

        start_time = time.time()
        while time.time() - start_time < 7:
            logs = driver.get_log('performance')
            for entry in logs:
                try:
                    msg = json.loads(entry['message'])['message']
                    method = msg.get('method', '')
                    if method == 'Network.requestWillBeSent':
                        req_url = msg.get('params', {}).get('request', {}).get('url', '')
                        if 'workspacevideo-pa.clients6.google.com' in req_url and 'playback?' in req_url:
                            r_id = msg.get('params', {}).get('requestId')
                            body = driver.execute_cdp_cmd('Network.getResponseBody', {'requestId': r_id})
                            playback_data = json.loads(body.get('body', '{}'))
                            break
                except Exception:
                    pass
            if playback_data:
                break
            time.sleep(0.5)

        if not playback_data:
            print(json.dumps({"ok": False, "error": "Playback API response not captured"}))
            sys.exit(0)

        user_agent = driver.execute_script('return navigator.userAgent')
        msd = playback_data.get('mediaStreamingData', {})
        resp_str = msd.get('serializedHouseBrandPlayerResponse')

        if not resp_str:
            print(json.dumps({"ok": False, "error": "No player response in playback data"}))
            sys.exit(0)

        player = json.loads(resp_str)
        streaming_data = player.get('streamingData', {})
        formats = streaming_data.get('formats', [])

        if not formats:
            # Fallback to adaptive formats if no progressive format
            adaptive = streaming_data.get('adaptiveFormats', [])
            if adaptive:
                formats = [f for f in adaptive if 'video' in f.get('mimeType', '')]

        if not formats:
            print(json.dumps({"ok": False, "error": "No formats found in streaming data"}))
            sys.exit(0)

        # Prefer 720p (itag 22), then 360p (itag 18), or highest quality
        formats.sort(key=lambda x: (x.get('height') or (720 if x.get('itag') == 22 else 360 if x.get('itag') == 18 else 0)), reverse=True)
        chosen = formats[0]

        result = {
            "ok": True,
            "videoUrl": chosen.get('url'),
            "userAgent": user_agent,
            "contentType": chosen.get('mimeType', 'video/mp4').split(';')[0].strip(),
            "quality": chosen.get('qualityLabel') or f"{chosen.get('height')}p" if chosen.get('height') else "720p",
            "itag": chosen.get('itag'),
            "expiresInSeconds": int(streaming_data.get('expiresInSeconds', 10800)),
            "title": player.get('videoDetails', {}).get('title', '')
        }
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
    finally:
        if driver:
            try:
                service_pid = driver.service.process.pid if hasattr(driver, 'service') and driver.service and driver.service.process else None
                driver.quit()
                if service_pid:
                    try:
                        import signal
                        os.kill(service_pid, signal.SIGKILL)
                    except Exception:
                        pass
            except Exception:
                pass

if __name__ == '__main__':
    main()

from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def make_image(size=(850, 950)):
    data = BytesIO()
    Image.new('RGB', size, (135, 145, 155)).save(data, 'JPEG')
    return data.getvalue()

def test_photo_analysis():
    response = client.post('/api/analyze', files={'photo': ('photo.jpg', make_image(), 'image/jpeg')})
    assert response.status_code == 200
    result = response.json()
    assert result['width'] == 850
    assert result['height'] == 950
    assert isinstance(result['tips'], list)

def test_enhancement():
    response = client.post('/api/enhance', files={'photo': ('photo.jpg', make_image(), 'image/jpeg')}, data={'strength': '0.6'})
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('image/jpeg')
    assert Image.open(BytesIO(response.content)).size == (850, 950)

def test_file_validation():
    response = client.post('/api/analyze', files={'photo': ('invalid.txt', b'not an image', 'text/plain')})
    assert response.status_code == 415

def test_invalid_strength():
    response = client.post('/api/enhance', files={'photo': ('photo.jpg', make_image(), 'image/jpeg')}, data={'strength': '1.4'})
    assert response.status_code == 422

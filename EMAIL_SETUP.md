# Gmail E-posta Kurulumu

E-posta gönderme özelliğini kullanmak için Gmail App Password ayarlamanız gerekmektedir.

## Adım 1: Gmail'de 2 Adımlı Doğrulamayı Aktif Edin

1. Google Hesabınıza gidin
2. Güvenlik bölümüne gidin
3. "Google'da oturum açma" bölümünde "2 Adımlı Doğrulama"yı etkinleştirin

## Adım 2: Uygulama Şifresi Oluşturun

1. Google Hesabı > Güvenlik > Uygulama şifreleri bölümüne gidin
2. "Uygulama seçin" dropdown'ından "Diğer (özel ad)" seçin
3. "Uygulama adı" olarak "Eyüboğulları Backend" yazın
4. "Oluştur" butonuna tıklayın
5. Oluşturulan 16 haneli şifreyi kopyalayın (boşluklar olmadan)

## Adım 3: .env Dosyasını Güncelleyin

`backend/.env` dosyasında `EMAIL_PASS` değerini kopyaladığınız uygulama şifresi ile değiştirin:

```env
EMAIL_USER=eyubogullariinsaat@gmail.com
EMAIL_PASS=kopyaladiginiz-16-haneli-sifre
```

## Adım 4: Backend'i Yeniden Başlatın

```bash
cd backend
npm start
```

## Test

İletişim formunu doldurup gönderdiğinizde `eyubogullariinsaat@gmail.com` adresine formatlanmış bir e-posta gelecektir.

## Notlar

- Gmail App Password, normal şifrenizden farklıdır
- Bu şifreyi asla kimseyle paylaşmayın ve kodda açıkça belirtmeyin
- Her zaman .env dosyasını kullanın

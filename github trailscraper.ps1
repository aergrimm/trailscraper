# 1. Navigeer naar de juiste map
Set-Location "C:\Users\denni\Documents\trailscraper"

# 2. Stel je Git identiteit in (nodig voor commits)
git config --global user.name "aergrimm"
git config --global user.email "info@aergrimm.nl"  # Pas eventueel aan naar jouw e-mail

# 3. Negeer de melding over regeleinden (LF / CRLF)
git config --global core.autocrlf true

# 4. Voeg alle bestanden toe en maak de eerste commit
git add .
git commit -m "Initial commit van trailscraper"

# 5. Zorg dat de branch 'main' heet
git branch -M main

# 6. Herstel de remote URL naar je juiste GitHub repository
git remote remove origin 2>$null
git remote add origin https://github.com/aergrimm/trailscraper.git

# 7. Push de code naar GitHub
git push -u origin main
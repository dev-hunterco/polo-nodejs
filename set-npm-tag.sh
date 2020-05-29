
echo "TAG IDENTIFICADA: " $TRAVIS_TAG
if [ -z "$TRAVIS_TAG" ]; then
  export NPM_TAG=next;
else
  export NPM_TAG=$TRAVIS_TAG;
fi

echo NPM_TAG_SETADA: $NPM_TAG